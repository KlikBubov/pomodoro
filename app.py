import os
from flask import Flask, render_template, request, jsonify
from flask_talisman import Talisman
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Default Pomodoro configuration (in minutes)
SETTINGS = {
    "work": 25,
    "short_break": 5,
    "long_break": 15,
    "long_break_interval": 4,
}

app = Flask(__name__)
app.config['SERVER_NAME'] = None  # Don't broadcast the internal name
# Note: A reverse proxy like Nginx is better at hiding this completely.

# Talisman automatically sets:
# - Strict-Transport-Security (forces HTTPS)
# - X-Frame-Options: DENY (prevents clickjacking)
# - Content-Security-Policy (prevents XSS by restricting where scripts can load from)
Talisman(app,
         content_security_policy={
             'default-src': "'self'",
             'style-src': ["'self'", 'https://fonts.googleapis.com'],
             'font-src': ["'self'", 'https://fonts.gstatic.com'],
             'script-src': "'self'",
             # Note: We allow inline scripts for the SETTINGS variable,
             # but for maximum security, move that script to an external .js file.
         },
         force_https=False  # Set to True once you have an SSL certificate deployed
         )

# Rate limiter setup
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)


# Apply a strict limit to the API endpoint
@app.route("/api/log-session", methods=["POST"])
@limiter.limit("10 per minute")  # Prevent spamming
def log_session():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "work")

    # Validate input! Don't trust the user.
    if mode not in ["work", "short", "long"]:
        return jsonify({"status": "error", "message": "Invalid mode"}), 400

    print(f"[Pomodoro] Logged session: {mode}")
    return jsonify({"status": "ok", "mode": mode})


@app.route("/")
def index():
    return render_template("index.html", settings=SETTINGS)


@app.route("/api/log-session", methods=["POST"])
def log_session():
    """Optional endpoint to log completed focus sessions.
    In a real app you'd persist this to a database."""
    data = request.get_json() or {}
    mode = data.get("mode", "work")
    print(f"[Pomodoro] Logged session: {mode}")
    return jsonify({"status": "ok", "mode": mode})


if __name__ == "__main__":
    is_debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=is_debug, port=5000)
