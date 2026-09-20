from flask import Blueprint, request, jsonify, session
from models.project import ProjectModel
from models.backup import BackupManager
from models.permissions import Permission, PermissionModel
from routes.access import require_permission

projects_bp = Blueprint("projects", __name__, url_prefix="/api/projects")


def _with_permissions(project: dict) -> dict:
    """Attach the caller's effective permissions so the frontend knows what
    management UI (edit, delete, manage members, ...) it's allowed to show."""
    project = dict(project)
    project["my_permissions"] = PermissionModel.effective_permissions(project, session.get("username"))
    project["is_owner"] = project.get("owner_username") == session.get("username")
    return project


@projects_bp.route("/", methods=["GET"])
def list_projects():
    projects = ProjectModel.get_all_visible_to(session["username"])
    return jsonify([_with_permissions(p) for p in projects])


@projects_bp.route("/<int:project_id>", methods=["GET"])
@require_permission(Permission.VIEW)
def get_project(project_id):
    return jsonify(_with_permissions(ProjectModel.get_by_id(project_id)))


@projects_bp.route("/", methods=["POST"])
def create_project():
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    BackupManager.modify()
    project = ProjectModel.create(
        name=name,
        description=body.get("description", ""),
        color=body.get("color", "#6366f1"),
        owner_username=session["username"],
    )
    return jsonify(_with_permissions(project)), 201


@projects_bp.route("/<int:project_id>", methods=["PATCH"])
@require_permission(Permission.EDIT_PROJECT)
def update_project(project_id):
    body = request.get_json(silent=True) or {}
    project = ProjectModel.update(project_id, body)
    BackupManager.modify()
    return jsonify(_with_permissions(project))


@projects_bp.route("/<int:project_id>", methods=["DELETE"])
@require_permission(Permission.DELETE_PROJECT)
def delete_project(project_id):
    ProjectModel.delete(project_id)
    BackupManager.modify()
    return "", 204


@projects_bp.route("/<int:project_id>/export", methods=["GET"])
@require_permission(Permission.VIEW)
def export_project(project_id):
    from models.module import ModuleModel
    project = ProjectModel.get_by_id(project_id)
    modules = ModuleModel.get_for_project(project_id)
    return jsonify({
        "project": {k: project[k] for k in ("name", "description", "color")},
        "modules": [
            {"title": m["title"], "module_type": m["module_type"], "data": m["data"], "position": m["position"]}
            for m in modules
        ],
    })


@projects_bp.route("/import", methods=["POST"])
def import_project():
    from models.module import ModuleModel
    body = request.get_json(silent=True) or {}
    project_fields = body.get("project", {})
    name = project_fields.get("name", "").strip()
    if not name:
        return jsonify({"error": "project.name is required"}), 400

    project = ProjectModel.create(
        name=name,
        description=project_fields.get("description", ""),
        color=project_fields.get("color", "#6366f1"),
        owner_username=session["username"],
    )
    for m in body.get("modules", []):
        if not m.get("module_type") or not m.get("title"):
            continue
        ModuleModel.create(
            project_id=project["id"],
            module_type=m["module_type"],
            title=m["title"],
            data=m.get("data", {}),
            position=m.get("position", 0),
        )
    BackupManager.modify()
    return jsonify(ProjectModel.get_by_id(project["id"])), 201
