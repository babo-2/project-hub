from functools import wraps

from flask import jsonify, session, g

from models.project import ProjectModel
from models.permissions import PermissionModel

# Human-readable phrasing for each permission, used in 403 messages.
_PERMISSION_PHRASES = {
    "view":            "view this project",
    "edit_project":    "edit this project's details",
    "delete_project":  "delete this project",
    "manage_modules":  "manage modules in this project",
    "manage_members":  "manage members or roles in this project",
    "manage_backups":  "view or restore backups for this project",
}


def permission_denied_message(permission: str) -> str:
    phrase = _PERMISSION_PHRASES.get(permission, f"{permission.replace('_', ' ')} in this project")
    return f"You don't have permission to {phrase}."


def require_permission(permission: str, project_id_arg: str = "project_id"):
    """
    Route decorator: loads the project named by `project_id_arg` (a URL
    kwarg), 404s if it doesn't exist, 403s if the logged-in user lacks
    `permission` on it. On success the project dict is stashed on
    `g.project` so the view doesn't have to fetch it again.
    """
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            project_id = kwargs.get(project_id_arg)
            project = ProjectModel.get_by_id(project_id)
            if not project:
                return jsonify({"error": "Not found"}), 404

            username = session.get("username")
            if not PermissionModel.check(project, username, permission):
                return jsonify({"error": permission_denied_message(permission)}), 403

            g.project = project
            return view(*args, **kwargs)
        return wrapped
    return decorator
