from flask import Blueprint, request, jsonify, session
from models.module import ModuleModel
from models.backup import BackupManager
from models.project import ProjectModel
from models.permissions import Permission, PermissionModel
from routes.access import require_permission, permission_denied_message

modules_bp = Blueprint("modules", __name__, url_prefix="/api/projects")


@modules_bp.route("/<int:project_id>/modules", methods=["GET"])
@require_permission(Permission.VIEW)
def list_modules(project_id):
    return jsonify(ModuleModel.get_for_project(project_id))


@modules_bp.route("/<int:project_id>/modules", methods=["POST"])
@require_permission(Permission.MANAGE_MODULES)
def create_module(project_id):
    body = request.get_json(silent=True) or {}
    module_type = body.get("module_type", "").strip()
    title = body.get("title", "").strip()

    if not module_type or not title:
        return jsonify({"error": "module_type and title are required"}), 400

    module = ModuleModel.create(
        project_id=project_id,
        module_type=module_type,
        title=title,
        data=body.get("data", {}),
        position=body.get("position", 0),
    )
    BackupManager.modify()
    return jsonify(module), 201


@modules_bp.route("/<int:project_id>/modules/reorder", methods=["POST"])
@require_permission(Permission.MANAGE_MODULES)
def reorder_modules(project_id):
    body = request.get_json(silent=True) or {}
    ordered_ids = body.get("ordered_ids", [])
    if not isinstance(ordered_ids, list):
        return jsonify({"error": "ordered_ids must be a list"}), 400
    ModuleModel.reorder(project_id, ordered_ids)
    BackupManager.modify()
    return jsonify({"status": "ok"})


def _forbidden(permission):
    return jsonify({"error": permission_denied_message(permission)}), 403


def _module_and_project_or_404(module_id):
    """Shared lookup for the /modules/<id> routes, which only get a module_id."""
    module = ModuleModel.get_by_id(module_id)
    if not module:
        return None, None
    project = ProjectModel.get_by_id(module["project_id"])
    return module, project


@modules_bp.route("/modules/<int:module_id>", methods=["GET"])
def get_module(module_id):
    module, project = _module_and_project_or_404(module_id)
    if not module or not project:
        return jsonify({"error": "Not found"}), 404
    if not PermissionModel.check(project, session.get("username"), Permission.VIEW):
        return _forbidden(Permission.VIEW)
    return jsonify(module)


@modules_bp.route("/modules/<int:module_id>", methods=["PATCH"])
def update_module(module_id):
    module, project = _module_and_project_or_404(module_id)
    if not module or not project:
        return jsonify({"error": "Not found"}), 404
    if not PermissionModel.check(project, session.get("username"), Permission.MANAGE_MODULES):
        return _forbidden(Permission.MANAGE_MODULES)

    body = request.get_json(silent=True) or {}
    module = ModuleModel.update(module_id, body)
    BackupManager.modify()
    return jsonify(module)


@modules_bp.route("/modules/<int:module_id>", methods=["DELETE"])
def delete_module(module_id):
    module, project = _module_and_project_or_404(module_id)
    if not module or not project:
        return jsonify({"error": "Not found"}), 404
    if not PermissionModel.check(project, session.get("username"), Permission.MANAGE_MODULES):
        return _forbidden(Permission.MANAGE_MODULES)

    ModuleModel.delete(module_id)
    BackupManager.modify()
    return "", 204


@modules_bp.route("/modules/<int:module_id>/export", methods=["GET"])
def export_module(module_id):
    module, project = _module_and_project_or_404(module_id)
    if not module or not project:
        return jsonify({"error": "Not found"}), 404
    if not PermissionModel.check(project, session.get("username"), Permission.VIEW):
        return _forbidden(Permission.VIEW)
    return jsonify({"title": module["title"], "module_type": module["module_type"], "data": module["data"]})


@modules_bp.route("/<int:project_id>/modules/import", methods=["POST"])
@require_permission(Permission.MANAGE_MODULES)
def import_module(project_id):
    body = request.get_json(silent=True) or {}
    module_type = body.get("module_type", "").strip()
    title = body.get("title", "").strip()
    if not module_type or not title:
        return jsonify({"error": "module_type and title are required"}), 400
    module = ModuleModel.create(
        project_id=project_id,
        module_type=module_type,
        title=title,
        data=body.get("data", {}),
        position=body.get("position", 0),
    )
    BackupManager.modify()
    return jsonify(module), 201
