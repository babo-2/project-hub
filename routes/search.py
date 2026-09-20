from flask import Blueprint, request, jsonify, session
from models.search import SearchModel
from models.project import ProjectModel
from models.permissions import PermissionModel

search_bp = Blueprint("search", __name__, url_prefix="/api/search")


@search_bp.route("", methods=["GET"])
def search():
    query = request.args.get("q", "").strip()
    use_regex = request.args.get("regex", "false").lower() == "true"

    all_projects = ProjectModel.get_all()
    visible_ids = PermissionModel.visible_project_ids(all_projects, session["username"])

    try:
        results = SearchModel.search(query, visible_ids, use_regex)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(results)
