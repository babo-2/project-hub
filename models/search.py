import json
import re

from db.database import get_connection


class SearchModel:
    """
    Full-text-ish search over projects and modules. Plain mode does a
    case-insensitive substring match; regex mode compiles the query as a
    Python regex and matches against the same text. Scoped to whatever
    project ids the caller says are visible to them.
    """

    @staticmethod
    def search(query: str, visible_project_ids: set[int], use_regex: bool = False) -> dict:
        if not query:
            return {"projects": [], "modules": []}

        try:
            matcher = re.compile(query, re.IGNORECASE) if use_regex else None
        except re.error as exc:
            raise ValueError(f"Invalid regex: {exc}")

        def matches(text: str) -> bool:
            if not text:
                return False
            if matcher:
                return matcher.search(text) is not None
            return query.lower() in text.lower()

        with get_connection() as conn:
            projects = conn.execute("SELECT * FROM projects").fetchall()
            modules = conn.execute("SELECT * FROM modules").fetchall()

        matched_projects = [
            dict(p) for p in projects
            if p["id"] in visible_project_ids and (matches(p["name"]) or matches(p["description"]))
        ]

        matched_modules = []
        for m in modules:
            if m["project_id"] not in visible_project_ids:
                continue
            if matches(m["title"]) or matches(m["data"]):
                d = dict(m)
                d["data"] = json.loads(d["data"])
                matched_modules.append(d)

        return {"projects": matched_projects, "modules": matched_modules}
