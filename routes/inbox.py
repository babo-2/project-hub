from flask import Blueprint, jsonify, session
from models.inbox import InboxModel

inbox_bp = Blueprint("inbox", __name__, url_prefix="/api/inbox")


def _own_message_or_404(message_id):
    message = InboxModel.get_by_id(message_id)
    if not message or message["username"] != session.get("username"):
        return None
    return message


@inbox_bp.route("", methods=["GET"])
def list_messages():
    return jsonify(InboxModel.get_for_user(session["username"]))


@inbox_bp.route("/unread-count", methods=["GET"])
def unread_count():
    return jsonify({"count": InboxModel.unread_count(session["username"])})


@inbox_bp.route("/<int:message_id>/read", methods=["POST"])
def mark_read(message_id):
    message = _own_message_or_404(message_id)
    if not message:
        return jsonify({"error": "Not found"}), 404
    return jsonify(InboxModel.mark_read(message_id))


@inbox_bp.route("/<int:message_id>/accept", methods=["POST"])
def accept(message_id):
    message = _own_message_or_404(message_id)
    if not message:
        return jsonify({"error": "Not found"}), 404
    if message["type"] != "invite" or message["status"] != "unread":
        return jsonify({"error": "This message can't be accepted"}), 400
    return jsonify(InboxModel.accept_invite(message))


@inbox_bp.route("/<int:message_id>/decline", methods=["POST"])
def decline(message_id):
    message = _own_message_or_404(message_id)
    if not message:
        return jsonify({"error": "Not found"}), 404
    if message["status"] != "unread":
        return jsonify({"error": "Already resolved"}), 400
    return jsonify(InboxModel.decline(message_id))


@inbox_bp.route("/<int:message_id>", methods=["DELETE"])
def delete(message_id):
    message = _own_message_or_404(message_id)
    if not message:
        return jsonify({"error": "Not found"}), 404
    InboxModel.delete(message_id)
    return "", 204
