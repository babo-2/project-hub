from flask import Blueprint, jsonify, request
from models.backup_browser import BackupBrowser
from models.permissions import Permission
from routes.access import require_permission

backups_bp = Blueprint("backups", __name__, url_prefix="/api/backups")


def _parse_source(source: str):
    """'snapshot/<name>' or 'daily/<day>/<name>' -> (kind, day, name)."""
    parts = source.split("/", 2)
    if parts[0] == "snapshot" and len(parts) == 2:
        return "snapshot", None, parts[1]
    if parts[0] == "daily" and len(parts) == 3:
        return "daily", parts[1], parts[2]
    return None, None, None


def _parse_module_path(raw: str) -> list:
    """'42' -> [42]; '42/c-abc' -> [42, 'c-abc']. First segment (the
    top-level module id) must be numeric; nested segments are opaque
    client-generated ids and stay as strings."""
    segments = raw.split("/")
    if not segments or not segments[0].isdigit():
        raise ValueError("path must start with a numeric top-level module id")
    return [int(segments[0]), *segments[1:]]


@backups_bp.route("/sources", methods=["GET"])
def list_sources():
    return jsonify(BackupBrowser.list_sources())


@backups_bp.route("/<path:source>/projects/<int:project_id>/diff", methods=["GET"])
@require_permission(Permission.MANAGE_BACKUPS)
def diff_project(source, project_id):
    kind, day, name = _parse_source(source)
    if not kind:
        return jsonify({"error": "Invalid source"}), 400
    try:
        return jsonify(BackupBrowser.diff_project(kind, name, project_id, day))
    except FileNotFoundError:
        return jsonify({"error": "Snapshot not found"}), 404


@backups_bp.route("/<path:source>/projects/<int:project_id>/modules/<path:module_path>", methods=["GET"])
@require_permission(Permission.MANAGE_BACKUPS)
def preview_module(source, project_id, module_path):
    kind, day, name = _parse_source(source)
    if not kind:
        return jsonify({"error": "Invalid source"}), 400
    path = _parse_module_path(module_path)
    try:
        module = BackupBrowser.get_module_snapshot(kind, name, project_id, path, day)
    except FileNotFoundError:
        return jsonify({"error": "Snapshot not found"}), 404
    if not module:
        return jsonify({"error": "Not found in this snapshot"}), 404
    return jsonify(module)


@backups_bp.route("/<path:source>/projects/<int:project_id>/push", methods=["POST"])
@require_permission(Permission.MANAGE_BACKUPS)
def push(source, project_id):
    kind, day, name = _parse_source(source)
    if not kind:
        return jsonify({"error": "Invalid source"}), 400

    body = request.get_json(silent=True) or {}
    paths = body.get("paths", "all")
    if paths != "all":
        if not isinstance(paths, list):
            return jsonify({"error": "paths must be 'all' or a list of paths"}), 400
        try:
            paths = [_parse_module_path(p if isinstance(p, str) else "/".join(str(seg) for seg in p)) for p in paths]
        except (ValueError, TypeError):
            return jsonify({"error": "Malformed path in paths"}), 400

    try:
        result = BackupBrowser.push(
            kind, name, project_id, paths,
            include_project_meta=bool(body.get("include_project_meta", False)),
            day=day,
        )
    except FileNotFoundError:
        return jsonify({"error": "Snapshot not found"}), 404
    return jsonify(result)
