import os
import sqlite3
import traceback
import secrets
import re
import json
import threading
import requests
import sentry_sdk
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, g, session, redirect, url_for, Response, send_from_directory
from flask_talisman import Talisman
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# --- Configuration ---
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
IS_DEBUG = os.environ.get("FLASK_DEBUG", "False").lower() == "true"

# --- GlitchTip (Error Tracking) ---
SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=1.0, profiles_sample_rate=1.0)

# --- Flask-Login Setup ---
login_manager = LoginManager()
login_manager.init_app(app)


class User(UserMixin):
    def __init__(self, id, email, work, short_break, long_break, total_sessions):
        self.id = id
        self.email = email
        self.work = work
        self.short_break = short_break
        self.long_break = long_break
        self.total_sessions = total_sessions


@login_manager.user_loader
def load_user(user_id):
    db = get_db()
    user_row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user_row:
        return None
    return User(user_row['id'], user_row['email'], user_row['work'], user_row['short_break'], user_row['long_break'],
                user_row['total_sessions'])


# --- Security & Rate Limiting ---
limiter = Limiter(get_remote_address, app=app, default_limits=["200 per day", "50 per hour"], storage_uri="memory://")

Talisman(app,
         content_security_policy={
             'default-src': "'self'",
             'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
             'font-src': ["'self'", 'https://fonts.gstatic.com'],
             'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://umami.25x5.ru'],
             'img-src': ["'self'", 'data:'],
             'connect-src': ["'self'", 'https://glitchtip.25x5.ru', 'https://umami.25x5.ru',
                             'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net']
         },
         force_https=False,
         session_cookie_secure=False
         )

SETTINGS = {"work": 25, "short_break": 5, "long_break": 15, "long_break_interval": 4}
DB_PATH = "data/app.db"
os.makedirs("data", exist_ok=True)

UMAMI_URL = os.environ.get("UMAMI_URL", "/umami")
UMAMI_ID = os.environ.get("UMAMI_ID", "")
DOMAIN = os.environ.get("DOMAIN", "localhost")


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    db = get_db()
    db.execute(
        '''CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, timestamp TEXT, event_type TEXT, data TEXT)''')
    db.execute(
        '''CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY, timestamp TEXT, source TEXT, message TEXT, stack TEXT)''')
    db.execute('''CREATE TABLE IF NOT EXISTS users (
                  id INTEGER PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, 
                  work INTEGER DEFAULT 25, short_break INTEGER DEFAULT 5, long_break INTEGER DEFAULT 15, 
                  total_sessions INTEGER DEFAULT 0)''')
    db.execute('''CREATE TABLE IF NOT EXISTS sessions_log (
                  id INTEGER PRIMARY KEY, user_id INTEGER, duration INTEGER, timestamp TEXT)''')
    db.execute('''CREATE TABLE IF NOT EXISTS webhooks (
                  id INTEGER PRIMARY KEY, user_id INTEGER, url TEXT, events TEXT)''')
    db.commit()


@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, '_database', None)
    if db is not None: db.close()


with app.app_context():
    init_db()


# --- Background Webhook Sender ---
def send_webhook(url, payload):
    try:
        requests.post(url, json=payload, timeout=3)
    except Exception as e:
        print(f"Webhook failed for {url}: {e}")


# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html", settings=SETTINGS, sentry_dsn=SENTRY_DSN or "", umami_url=UMAMI_URL,
                           umami_id=UMAMI_ID, domain=DOMAIN)


@app.route("/about")
def about():
    return render_template("about.html", domain=DOMAIN)


@app.route("/me")
@login_required
def me():
    return render_template("me.html", domain=DOMAIN)


@app.route("/robots.txt")
def robots():
    return Response(f"User-agent: *\nAllow: /\nSitemap: https://{DOMAIN}/sitemap.xml", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://{DOMAIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
    <url><loc>https://{DOMAIN}/about</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>"""
    return Response(xml, mimetype="application/xml")


@app.route('/static/js/sw.js')
def service_worker():
    response = send_from_directory('static/js', 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    return response


# --- Auth API ---
@app.route("/api/auth/status")
def auth_status():
    if current_user.is_authenticated:
        return jsonify({
            "logged_in": True,
            "email": current_user.email,
            "settings": {
                "work": current_user.work,
                "short_break": current_user.short_break,
                "long_break": current_user.long_break
            },
            "total_sessions": current_user.total_sessions
        })
    return jsonify({"logged_in": False})


@app.route("/api/auth/register", methods=["POST"])
@limiter.limit("5 per minute")
def register():
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")

    if not re.match(r"[^@]+@[^@]+\.[^@]+", email) or len(password) < 6:
        return jsonify({"status": "error", "message": "Invalid email or password too short (min 6 chars)"}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"status": "error", "message": "Email already registered"}), 409

    hashed_pw = generate_password_hash(password)
    cursor = db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, hashed_pw))
    db.commit()

    user = load_user(cursor.lastrowid)
    login_user(user)
    return jsonify({"status": "ok", "message": "Registered successfully"})


@app.route("/api/auth/login", methods=["POST"])
@limiter.limit("5 per minute")
def login():
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")

    db = get_db()
    user_row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user_row or not check_password_hash(user_row['password_hash'], password):
        return jsonify({"status": "error", "message": "Invalid credentials"}), 401

    user = load_user(user_row['id'])
    login_user(user)
    return jsonify({"status": "ok", "message": "Logged in successfully"})


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"status": "ok", "message": "Logged out"})


# --- App API ---
@app.route("/api/log-session", methods=["POST"])
@limiter.limit("10 per minute")
def log_session():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "work")
    if mode not in ["work", "short", "long"]:
        return jsonify({"status": "error", "message": "Invalid mode"}), 400

    if current_user.is_authenticated and mode == "work":
        db = get_db()
        db.execute("UPDATE users SET total_sessions = total_sessions + 1 WHERE id = ?", (current_user.id,))
        db.execute("INSERT INTO sessions_log (user_id, duration, timestamp) VALUES (?, ?, ?)",
                   (current_user.id, current_user.work, datetime.now().isoformat()))
        db.commit()

    return jsonify({"status": "ok", "mode": mode})


@app.route("/api/notify", methods=["POST"])
@login_required
def notify_event():
    data = request.get_json(silent=True) or {}
    event_type = data.get("event")
    task = data.get("task")

    if event_type not in ["focus_started", "focus_completed", "break_started", "break_completed"]:
        return jsonify({"status": "error", "message": "Invalid event"}), 400

    db = get_db()
    hooks = db.execute("SELECT url, events FROM webhooks WHERE user_id = ?", (current_user.id,)).fetchall()

    payload = {
        "event": event_type,
        "task": task,
        "timestamp": datetime.now().isoformat()
    }

    for hook in hooks:
        try:
            events = json.loads(hook["events"])
            if event_type in events:
                threading.Thread(target=send_webhook, args=(hook["url"], payload), daemon=True).start()
        except:
            pass

    return jsonify({"status": "ok"})


@app.route("/api/settings", methods=["POST"])
@login_required
def update_settings():
    data = request.get_json(silent=True) or {}
    work = int(data.get("work", 25))
    short_break = int(data.get("short_break", 5))
    long_break = int(data.get("long_break", 15))

    db = get_db()
    db.execute("UPDATE users SET work = ?, short_break = ?, long_break = ? WHERE id = ?",
               (work, short_break, long_break, current_user.id))
    db.commit()
    return jsonify({"status": "ok"})


# --- Webhooks API ---
@app.route("/api/webhooks", methods=["GET", "POST", "DELETE"])
@login_required
def manage_webhooks():
    db = get_db()

    if request.method == "GET":
        hooks = db.execute("SELECT id, url, events FROM webhooks WHERE user_id = ?", (current_user.id,)).fetchall()
        return jsonify([{"id": h["id"], "url": h["url"], "events": json.loads(h["events"])} for h in hooks])

    elif request.method == "POST":
        data = request.get_json(silent=True) or {}
        url = data.get("url", "").strip()
        events = data.get("events", [])

        if not url.startswith("http://") and not url.startswith("https://"):
            return jsonify({"status": "error", "message": "Invalid URL"}), 400
        if not isinstance(events, list) or not all(
                e in ["focus_started", "focus_completed", "break_started", "break_completed"] for e in events):
            return jsonify({"status": "error", "message": "Invalid events"}), 400

        cursor = db.execute("INSERT INTO webhooks (user_id, url, events) VALUES (?, ?, ?)",
                            (current_user.id, url, json.dumps(events)))
        db.commit()
        return jsonify({"status": "ok", "id": cursor.lastrowid})

    elif request.method == "DELETE":
        hook_id = request.args.get("id")
        if not hook_id:
            return jsonify({"status": "error", "message": "ID required"}), 400
        db.execute("DELETE FROM webhooks WHERE id = ? AND user_id = ?", (hook_id, current_user.id))
        db.commit()
        return jsonify({"status": "ok"})


# --- Stats API ---
@app.route("/api/stats")
@login_required
def get_stats():
    db = get_db()
    logs = db.execute("SELECT duration, timestamp FROM sessions_log WHERE user_id = ? ORDER BY timestamp DESC",
                      (current_user.id,)).fetchall()

    total_sessions = current_user.total_sessions
    total_minutes = sum([log['duration'] for log in logs])

    daily_data = []
    for i in range(6, -1, -1):
        date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        minutes = sum([log['duration'] for log in logs if log['timestamp'].startswith(date)])
        daily_data.append({"date": date, "minutes": minutes})

    dates_with_sessions = set()
    for log in logs:
        try:
            dates_with_sessions.add(datetime.fromisoformat(log['timestamp']).date())
        except:
            pass

    streak = 0
    today = datetime.now().date()

    if today in dates_with_sessions:
        streak = 1
        prev_day = today - timedelta(days=1)
        while prev_day in dates_with_sessions:
            streak += 1
            prev_day -= timedelta(days=1)
    else:
        yesterday = today - timedelta(days=1)
        if yesterday in dates_with_sessions:
            streak = 1
            prev_day = yesterday - timedelta(days=1)
            while prev_day in dates_with_sessions:
                streak += 1
                prev_day -= timedelta(days=1)

    return jsonify({
        "total_sessions": total_sessions,
        "total_minutes": total_minutes,
        "streak": streak,
        "daily_data": daily_data
    })


@app.route("/api/feedback", methods=["POST"])
@limiter.limit("3 per minute")
def submit_feedback():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()
    if not message or len(message) > 1000:
        return jsonify({"status": "error", "message": "Message must be between 1 and 1000 characters"}), 400
    with open("data/feedback.log", "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] IP: {request.remote_addr} - {message}\n")
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=IS_DEBUG, port=5000)
