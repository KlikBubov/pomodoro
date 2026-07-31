import os

from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Default Pomodoro configuration (in minutes)
SETTINGS = {
    "work": 25,
    "short_break": 5,
    "long_break": 15,
    "long_break_interval": 4,
}


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
