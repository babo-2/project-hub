from flask import Blueprint, render_template, request, jsonify, session, current_app
from models.auth import Auth

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


@auth_bp.before_app_request
def auth():
    if request.path.startswith("/auth") or request.path in ("/manifest.json", "/ping"):
        return
    if Auth.validate_session(session.get("session_id"), session.get("username")):
        return
    if request.path.startswith("/api"):
        return jsonify({"error": "Unauthorized"}), 401
    return render_template("auth.html")


@auth_bp.route("/", methods=["GET"])
def renderAuth():
    return render_template("auth.html")


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    has_account = Auth.login(data["username"], data["password"])
    if not has_account:
        return jsonify({"success": False, "cause": "Wrong username or password"})
    session["session_id"] = Auth.generate_session_id(data["username"])
    session["username"] = data["username"]
    return jsonify({"success": True})


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not current_app.config["CAN_REGISTER"]:
        return jsonify({"success": False, "cause": "registering is currently disabled"})
    can_register = Auth.register(data["username"], data["password"])
    if not can_register:
        return jsonify({"success": False, "cause": "username already exist"})
    session["session_id"] = Auth.generate_session_id(data["username"])
    session["username"] = data["username"]
    return jsonify({"success": True})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    if "session_id" not in session:
        return jsonify({"success": False, "cause": "You are not logged in"})
    was_logged_in = Auth.logout(session["session_id"])
    if not was_logged_in:
        return jsonify({"success": False, "cause": "You are not logged in"})
    return jsonify({"success": True})
