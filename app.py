import os
import sentry_sdk
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response
from flask_talisman import Talisman
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# --- GlitchTip (Error Tracking) Initialization ---
SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
    )

# --- Security & Rate Limiting ---
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

IS_DEBUG = os.environ.get("FLASK_DEBUG", "False").lower() == "true"

Talisman(app,
         content_security_policy={
             'default-src': "'self'",
             'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
             'font-src': ["'self'", 'https://fonts.gstatic.com'],
             'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://umami.25x5.ru'],
             'img-src': ["'self'", 'data:'],
             'connect-src': ["'self'", 'https://glitchtip.25x5.ru', 'https://umami.25x5.ru']
         },
         force_https=not IS_DEBUG
         )

# --- App Configuration ---
SETTINGS = {
    "work": 25,
    "short_break": 5,
    "long_break": 15,
    "long_break_interval": 4,
}

# Ensure data directory exists
os.makedirs("data", exist_ok=True)

UMAMI_URL = os.environ.get("UMAMI_URL", "/umami")
UMAMI_ID = os.environ.get("UMAMI_ID", "")
DOMAIN = os.environ.get("DOMAIN", "localhost") \
 \
         @ app.route("/")


def index():
    return render_template(
        "index.html",
        settings=SETTINGS,
        sentry_dsn=SENTRY_DSN or "",
        umami_url=UMAMI_URL,
        umami_id=UMAMI_ID,
        domain=DOMAIN
    )


@app.route("/about")
def about():
    return render_template("about.html", domain=DOMAIN)


@app.route("/robots.txt")
def robots():
    # Allow all bots to crawl
    return Response(f"User-agent: *\nAllow: /\nSitemap: https://{DOMAIN}/sitemap.xml", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://{DOMAIN}/</loc>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>https://{DOMAIN}/about</loc>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
</urlset>"""
    return Response(xml, mimetype="application/xml")


@app.route("/api/log-session", methods=["POST"])
@limiter.limit("10 per minute")
def log_session():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "work")
    if mode not in ["work", "short", "long"]:
        return jsonify({"status": "error", "message": "Invalid mode"}), 400
    return jsonify({"status": "ok", "mode": mode})


@app.route("/api/feedback", methods=["POST"])
@limiter.limit("3 per minute")
def submit_feedback():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()

    if not message or len(message) > 1000:
        return jsonify({"status": "error", "message": "Message must be between 1 and 1000 characters"}), 400

    with open("data/feedback.log", "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] IP: {request.remote_addr} - {message}\n")

    return jsonify({"status": "ok", "message": "Feedback received"})


@app.route("/error")
@limiter.limit("10 per minute")
def trigger_error():
    division_by_zero = 1 / 0


if __name__ == "__main__":
    app.run(debug=IS_DEBUG, port=5000)
