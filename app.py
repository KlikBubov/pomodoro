import os
import sqlite3
import traceback
import secrets
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g, session, redirect, url_for
from flask_talisman import Talisman
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# --- Конфигурация и безопасность ---
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin")

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

Talisman(app,
         content_security_policy={
             'default-src': "'self'",
             'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
             'font-src': ["'self'", 'https://fonts.gstatic.com'],
             'script-src': ["'self'", "'unsafe-inline'"],
             'img-src': ["'self'", 'data:'],
             'connect-src': "'self'"
         },
         force_https=True
         )

SETTINGS = {
    "work": 25,
    "short_break": 5,
    "long_break": 15,
    "long_break_interval": 4,
}

DB_PATH = "data/app.db"
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    db = get_db()
    db.execute('''CREATE TABLE IF NOT EXISTS events 
                  (id INTEGER PRIMARY KEY, timestamp TEXT, event_type TEXT, data TEXT)''')
    db.execute('''CREATE TABLE IF NOT EXISTS errors 
                  (id INTEGER PRIMARY KEY, timestamp TEXT, source TEXT, message TEXT, stack TEXT)''')
    db.commit()


@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


with app.app_context():
    init_db()


@app.route("/admin/login", methods=["GET", "POST"])
@limiter.limit("5 per minute")
def admin_login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        if secrets.compare_digest(username, ADMIN_USER) and secrets.compare_digest(password, ADMIN_PASS):
            session["logged_in"] = True
            return redirect(url_for("admin"))
        return render_template("admin_login.html", error="Неверный логин или пароль")

    return render_template("admin_login.html")


@app.route("/admin/logout")
def admin_logout():
    session.pop("logged_in", None)
    return redirect(url_for("admin_login"))


@app.route("/admin")
def admin():
    if not session.get("logged_in"):
        return redirect(url_for("admin_login"))

    db = get_db()
    events = db.execute("SELECT * FROM events ORDER BY id DESC LIMIT 50").fetchall()
    errors = db.execute("SELECT * FROM errors ORDER BY id DESC LIMIT 50").fetchall()
    return render_template("admin.html", events=events, errors=errors)


@app.route("/")
def index():
    db = get_db()
    db.execute("INSERT INTO events (timestamp, event_type, data) VALUES (?, ?, ?)",
               (datetime.now().isoformat(), "pageview", "/"))
    db.commit()
    return render_template("index.html", settings=SETTINGS)


@app.route("/api/log-session", methods=["POST"])
@limiter.limit("10 per minute")
def log_session():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "work")

    if mode not in ["work", "short", "long"]:
        return jsonify({"status": "error", "message": "Invalid mode"}), 400

    db = get_db()
    db.execute("INSERT INTO events (timestamp, event_type, data) VALUES (?, ?, ?)",
               (datetime.now().isoformat(), "session_complete", mode))
    db.commit()
    return jsonify({"status": "ok", "mode": mode})


@app.route("/api/log-error", methods=["POST"])
@limiter.limit("10 per minute")
def log_error():
    data = request.get_json(silent=True) or {}
    db = get_db()
    db.execute("INSERT INTO errors (timestamp, source, message, stack) VALUES (?, ?, ?, ?)",
               (datetime.now().isoformat(), "frontend", data.get("message", "Unknown JS Error"), data.get("stack", "")))
    db.commit()
    return jsonify({"status": "ok"})


@app.errorhandler(Exception)
def handle_exception(e):
    db = get_db()
    db.execute("INSERT INTO errors (timestamp, source, message, stack) VALUES (?, ?, ?, ?)",
               (datetime.now().isoformat(), "backend", str(e), traceback.format_exc()))
    db.commit()
    return jsonify({"status": "error", "message": "Internal Server Error"}), 500


if __name__ == "__main__":
    is_debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"
    app.run(debug=is_debug, port=5000)
