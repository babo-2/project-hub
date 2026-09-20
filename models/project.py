from db.database import get_connection


class ProjectModel:
    """All DB operations for the `projects` table."""

    @staticmethod
    def get_all() -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    def get_by_id(project_id: int) -> dict | None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return dict(row) if row else None

    @staticmethod
    def create(name: str, description: str = "", color: str = "#6366f1", owner_username: str = None) -> dict:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO projects (name, description, color, owner_username) VALUES (?, ?, ?, ?)",
                (name, description, color, owner_username),
            )
            conn.commit()
            return ProjectModel.get_by_id(cur.lastrowid)

    @staticmethod
    def get_all_visible_to(username: str) -> list[dict]:
        """Projects the user owns, is a member of, or that predate ownership."""
        from models.permissions import PermissionModel
        all_projects = ProjectModel.get_all()
        visible_ids = PermissionModel.visible_project_ids(all_projects, username)
        return [p for p in all_projects if p["id"] in visible_ids]

    @staticmethod
    def update(project_id: int, fields: dict) -> dict | None:
        allowed = {"name", "description", "color"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return ProjectModel.get_by_id(project_id)

        updates["updated_at"] = "datetime('now')"
        set_clause = ", ".join(
            f"{k} = datetime('now')" if k == "updated_at" else f"{k} = ?"
            for k in updates
        )
        values = [v for k, v in updates.items() if k != "updated_at"]
        values.append(project_id)

        with get_connection() as conn:
            conn.execute(
                f"UPDATE projects SET {set_clause} WHERE id = ?", values
            )
            conn.commit()
        return ProjectModel.get_by_id(project_id)

    @staticmethod
    def delete(project_id: int) -> bool:
        with get_connection() as conn:
            cur = conn.execute(
                "DELETE FROM projects WHERE id = ?", (project_id,)
            )
            conn.commit()
            return cur.rowcount > 0
