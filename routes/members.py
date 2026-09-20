from flask import Blueprint, request, jsonify, session, g
from models.auth import Auth
from models.permissions import Permission, RoleModel, MemberModel, PermissionModel
from models.inbox import InboxModel
from routes.access import require_permission

members_bp = Blueprint("members", __name__, url_prefix="/api/projects/<int:project_id>")


# ---------------------------------------------------------------------------
# Assignable users — lightweight, view-only list for pickers (e.g. assigning
# a roadmap milestone). Deliberately separate from /members, which needs
# manage_members and returns full role detail.
# ---------------------------------------------------------------------------

@members_bp.route("/assignable-users", methods=["GET"])
@require_permission(Permission.VIEW)
def list_assignable_users(project_id):
    usernames = set()
    if g.project.get("owner_username"):
        usernames.add(g.project["owner_username"])
    for m in MemberModel.get_for_project(project_id):
        usernames.add(m["username"])
    return jsonify(sorted(usernames))


@members_bp.route("/my-access", methods=["GET"])
@require_permission(Permission.VIEW)
def my_access(project_id):
    username = session.get("username")
    is_owner = g.project.get("owner_username") == username or g.project.get("owner_username") is None
    roles = []
    if not is_owner:
        member = MemberModel.get_detail_for(project_id, username)
        roles = member["roles"] if member else []
    return jsonify({
        "is_owner": is_owner,
        "permissions": PermissionModel.effective_permissions(g.project, username),
        "roles": roles,
    })


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

@members_bp.route("/roles", methods=["GET"])
@require_permission(Permission.MANAGE_MEMBERS)
def list_roles(project_id):
    return jsonify(RoleModel.get_for_project(project_id))


@members_bp.route("/roles", methods=["POST"])
@require_permission(Permission.MANAGE_MEMBERS)
def create_role(project_id):
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    role = RoleModel.create(project_id, name, body.get("permissions", []))
    return jsonify(role), 201


@members_bp.route("/roles/<int:role_id>", methods=["PATCH"])
@require_permission(Permission.MANAGE_MEMBERS)
def update_role(project_id, role_id):
    body = request.get_json(silent=True) or {}
    role = RoleModel.update(role_id, body)
    if not role:
        return jsonify({"error": "Not found"}), 404
    return jsonify(role)


@members_bp.route("/roles/<int:role_id>", methods=["DELETE"])
@require_permission(Permission.MANAGE_MEMBERS)
def delete_role(project_id, role_id):
    RoleModel.delete(role_id)
    return "", 204


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

@members_bp.route("/members", methods=["GET"])
@require_permission(Permission.MANAGE_MEMBERS)
def list_members(project_id):
    return jsonify(MemberModel.get_for_project(project_id))


@members_bp.route("/members", methods=["POST"])
@require_permission(Permission.MANAGE_MEMBERS)
def invite_member(project_id):
    """Doesn't add the user directly - sends them an inbox invite they can
    accept or decline. Membership is only created on acceptance."""
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    if not username:
        return jsonify({"error": "username is required"}), 400
    if username not in Auth.accounts:
        return jsonify({"error": "No account with that username"}), 404
    if username == session.get("username"):
        return jsonify({"error": "You're already the owner"}), 400
    if MemberModel.get_username_for(project_id, username):
        return jsonify({"error": "Already a member"}), 400
    if InboxModel.has_pending_invite(username, project_id):
        return jsonify({"error": "This user already has a pending invite to this project"}), 400

    role_ids = body.get("role_ids", [])
    inviter = session.get("username")
    message = InboxModel.create(
        username=username,
        kind="system",
        type_="invite",
        title=f"Invitation to join \"{g.project['name']}\"",
        body=f"{inviter} invited you to collaborate on \"{g.project['name']}\".",
        payload={"project_id": project_id, "project_name": g.project["name"], "role_ids": role_ids, "invited_by": inviter},
    )
    return jsonify(message), 201


@members_bp.route("/members/<username>/roles", methods=["PUT"])
@require_permission(Permission.MANAGE_MEMBERS)
def set_member_roles(project_id, username):
    member = MemberModel.get_username_for(project_id, username)
    if not member:
        return jsonify({"error": "Not found"}), 404
    body = request.get_json(silent=True) or {}
    MemberModel.set_roles(member["id"], body.get("role_ids", []))
    return jsonify(MemberModel.get_detail_for(project_id, username))


@members_bp.route("/members/<username>", methods=["DELETE"])
@require_permission(Permission.MANAGE_MEMBERS)
def remove_member(project_id, username):
    MemberModel.remove(project_id, username)
    return "", 204
