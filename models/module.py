import json
from db.database import get_connection


class ModuleModel:
    """
    All DB operations for the `modules` table.

    A module is intentionally type-agnostic at the DB level.
    The `data` field is a JSON blob whose structure is defined
    entirely by the frontend module registered for that `module_type`.
    """

    @staticmethod
    def get_for_project(project_id: int) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM modules WHERE project_id = ? ORDER BY position ASC",
                (project_id,),
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["data"] = json.loads(d["data"])   # deserialise blob
                result.append(d)
            return result

    @staticmethod
    def get_by_id(module_id: int) -> dict | None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM modules WHERE id = ?", (module_id,)
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            d["data"] = json.loads(d["data"])
            return d

    @staticmethod
    def create(
        project_id: int,
        module_type: str,
        title: str,
        data: dict | None = None,
        position: int = 0,
    ) -> dict:
        payload = json.dumps(data or {})
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO modules (project_id, module_type, title, data, position)
                   VALUES (?, ?, ?, ?, ?)""",
                (project_id, module_type, title, payload, position),
            )
            conn.commit()
            return ModuleModel.get_by_id(cur.lastrowid)

    @staticmethod
    def update(module_id: int, fields: dict) -> dict | None:
        """Update title, data, and/or position. Data must be a dict."""
        allowed = {"title", "data", "position"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return ModuleModel.get_by_id(module_id)

        if "data" in updates:
            updates["data"] = json.dumps(updates["data"])

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        set_clause += ", updated_at = datetime('now')"
        values = list(updates.values()) + [module_id]

        with get_connection() as conn:
            conn.execute(
                f"UPDATE modules SET {set_clause} WHERE id = ?", values
            )
            conn.commit()
        return ModuleModel.get_by_id(module_id)

    @staticmethod
    def delete(module_id: int) -> bool:
        with get_connection() as conn:
            cur = conn.execute(
                "DELETE FROM modules WHERE id = ?", (module_id,)
            )
            conn.commit()
            return cur.rowcount > 0

    @staticmethod
    def reorder(project_id: int, ordered_ids: list[int]) -> None:
        """Bulk-update positions for a project's modules."""
        with get_connection() as conn:
            for pos, mod_id in enumerate(ordered_ids):
                conn.execute(
                    "UPDATE modules SET position = ? WHERE id = ? AND project_id = ?",
                    (pos, mod_id, project_id),
                )
            conn.commit()
