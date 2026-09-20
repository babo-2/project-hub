from flask import Blueprint, render_template, send_file, send_from_directory, session, current_app

frontend_bp = Blueprint("frontend", __name__, url_prefix="/")

@frontend_bp.route("/", methods=["GET"])
def index():
    return render_template("index.html", username=session.get("username"))

@frontend_bp.route("/project.html", methods=["GET"])
def project():
    return render_template("project.html", username=session.get("username"))

@frontend_bp.route("/manifest.json", methods=["GET"])
def manifest():
    return send_file(current_app.config["BASE_DIR"]+"/frontend/manifest.json", mimetype="application/json")


@frontend_bp.route("/sw.js", methods=["GET"])
def sw():
    return send_file(current_app.config["BASE_DIR"]+"/frontend/js/sw.js", mimetype="application/javascript")


# send_from_directory (not send_file) is required here: it resolves the
# final path and rejects anything that escapes the given directory, so a
# filename like "../../config.py" can't be used to read arbitrary files.
@frontend_bp.route("/css/<path:filename>", methods=["GET"])
def css(filename):
    return send_from_directory(current_app.config["BASE_DIR"]+"/frontend/css", filename, mimetype="text/css")

@frontend_bp.route("/js/<path:filename>", methods=["GET"])
def js(filename):
    return send_from_directory(current_app.config["BASE_DIR"]+"/frontend/js", filename, mimetype="application/javascript")

@frontend_bp.route("/ping", methods=["HEAD"])
def ping():
    return "", 204