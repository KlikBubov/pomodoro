import os
import sentry_sdk
from flask import Flask, render_template, request, jsonify
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

# Content Security Policy (теперь script-src 'self' закрывает все нужды)
Talisman(app,
         content_security_policy={
             'default-src': "'self'",
             'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
             'font-src': ["'self'", 'https://fonts.gstatic.com'],
             # Разрешаем загрузку Sentry SDK и скрипта Umami
             'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://umami.25x5.ru'],
             'img-src': ["'self'", 'data:'],
             # Разрешаем отправку ошибок в GlitchTip и статистики в Umami
             'connect-src': ["'self'", 'https://glitchtip.25x5.ru', 'https://umami.25x5.ru']
         },
         force_https=True  # Теперь можно включить строгий HTTPS
         )

# --- App Configuration ---
SETTINGS = {
    "work": 25,
    "short_break": 5,
    "long_break": 15,
    "long_break_interval": 4,
}

# Читаем настройки Umami
UMAMI_URL = os.environ.get("UMAMI_URL", "/umami")
UMAMI_ID = os.environ.get("UMAMI_ID", "")


@app.route("/")
def index():
    return render_template(
        "index.html",
        settings=SETTINGS,
        sentry_dsn=SENTRY_DSN or "",
        umami_url=UMAMI_URL,
        umami_id=UMAMI_ID
    )


@app.route("/api/log-session", methods=["POST"])
@limiter.limit("10 per minute")
def log_session():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "work")
    if mode not in ["work", "short", "long"]:
        return jsonify({"status": "error", "message": "Invalid mode"}), 400
    return jsonify({"status": "ok", "mode": mode})


@app.route("/error")
@limiter.limit("10 per minute")
def trigger_error():
    division_by_zero = 1 / 0


if __name__ == "__main__":
    is_debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"
    app.run(debug=is_debug, port=5000)
