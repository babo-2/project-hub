import json
from db.database import get_connection


class Permission:
    """
    All permission strings the app understands. A role's `permissions`
    column is just a JSON array of these — new permissions can be added
    here without any schema change.
    """
    VIEW            = "view"
    EDIT_PROJECT    = "edit_project"
    DELETE_PROJECT  = "delete_project"
    MANAGE_MODULES  = "manage_modules"
    MANAGE_MEMBERS  = "manage_members"
    MANAGE_BACKUPS  = "manage_backups"

    ALL = (VIEW, EDIT_PROJECT, DELETE_PROJECT, MANAGE_MODULES, MANAGE_MEMBERS, MANAGE_BACKUPS)


class RoleModel:
    """CRUD for per-project roles (name + a JSON list of Permission values)."""

    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["permissions"] = json.loads(d["permissions"])
        return d

    @staticmethod
    def get_for_project(project_id: int) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM roles WHERE project_id = ? ORDER BY name", (project_id,)
            ).fetchall()
            return [RoleModel._row_to_dict(r) for r in rows]

    @staticmethod
    def get_by_id(role_id: int) -> dict | None:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            return RoleModel._row_to_dict(row) if row else None

    @staticmethod
    def create(project_id: int, name: str, permissions: list[str]) -> dict:
        clean_perms = [p for p in permissions if p in Permission.ALL]
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO roles (project_id, name, permissions) VALUES (?, ?, ?)",
                (project_id, name, json.dumps(clean_perms)),
            )
            conn.commit()
            return RoleModel.get_by_id(cur.lastrowid)

    @staticmethod
    def update(role_id: int, fields: dict) -> dict | None:
        updates = {}
        if "name" in fields:
            updates["name"] = fields["name"]
        if "permissions" in fields:
            updates["permissions"] = json.dumps(
                [p for p in fields["permissions"] if p in Permission.ALL]
            )
        if not updates:
            return RoleModel.get_by_id(role_id)

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        with get_connection() as conn:
            conn.execute(
                f"UPDATE roles SET {set_clause} WHERE id = ?",
                [*updates.values(), role_id],
            )
            conn.commit()
        return RoleModel.get_by_id(role_id)

    @staticmethod
    def delete(role_id: int) -> bool:
        with get_connection() as conn:
            cur = conn.execute("DELETE FROM roles WHERE id = ?", (role_id,))
            conn.commit()
            return cur.rowcount > 0


class MemberModel:
    """CRUD for project members and the roles assigned to them."""

    @staticmethod
    def get_for_project(project_id: int) -> list[dict]:
        with get_connection() as conn:
            members = conn.execute(
                "SELECT * FROM project_members WHERE project_id = ? ORDER BY username",
                (project_id,),
            ).fetchall()
            result = []
            for m in members:
                role_rows = conn.execute(
                    """SELECT r.id, r.name FROM roles r
                       JOIN member_roles mr ON mr.role_id = r.id
                       WHERE mr.member_id = ?""",
                    (m["id"],),
                ).fetchall()
                d = dict(m)
                d["roles"] = [dict(r) for r in role_rows]
                result.append(d)
            return result

    @staticmethod
    def get_username_for(project_id: int, username: str) -> dict | None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM project_members WHERE project_id = ? AND username = ?",
                (project_id, username),
            ).fetchone()
            return dict(row) if row else None

    @staticmethod
    def get_detail_for(project_id: int, username: str) -> dict | None:
        """Same as get_username_for but includes the member's assigned roles."""
        member = MemberModel.get_username_for(project_id, username)
        if not member:
            return None
        with get_connection() as conn:
            role_rows = conn.execute(
                """SELECT r.id, r.name FROM roles r
                   JOIN member_roles mr ON mr.role_id = r.id
                   WHERE mr.member_id = ?""",
                (member["id"],),
            ).fetchall()
        member["roles"] = [dict(r) for r in role_rows]
        return member

    @staticmethod
    def add(project_id: int, username: str) -> dict | None:
        with get_connection() as conn:
            try:
                conn.execute(
                    "INSERT INTO project_members (project_id, username) VALUES (?, ?)",
                    (project_id, username),
                )
                conn.commit()
            except Exception:
                return None  # already a member
        return MemberModel.get_username_for(project_id, username)

    @staticmethod
    def remove(project_id: int, username: str) -> bool:
        with get_connection() as conn:
            cur = conn.execute(
                "DELETE FROM project_members WHERE project_id = ? AND username = ?",
                (project_id, username),
            )
            conn.commit()
            return cur.rowcount > 0

    @staticmethod
    def set_roles(member_id: int, role_ids: list[int]) -> None:
        with get_connection() as conn:
            conn.execute("DELETE FROM member_roles WHERE member_id = ?", (member_id,))
            for role_id in role_ids:
                conn.execute(
                    "INSERT OR IGNORE INTO member_roles (member_id, role_id) VALUES (?, ?)",
                    (member_id, role_id),
                )
            conn.commit()

    @staticmethod
    def permissions_for(project_id: int, username: str) -> set[str]:
        """Union of permissions granted to `username` in `project_id` via their roles."""
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT r.permissions FROM roles r
                   JOIN member_roles mr ON mr.role_id = r.id
                   JOIN project_members pm ON pm.id = mr.member_id
                   WHERE pm.project_id = ? AND pm.username = ?""",
                (project_id, username),
            ).fetchall()
        perms: set[str] = set()
        for row in rows:
            perms.update(json.loads(row["permissions"]))
        return perms


class PermissionModel:
    """The single place that decides whether a user may do something to a project."""

    @staticmethod
    def check(project: dict, username: str | None, permission: str) -> bool:
        """
        Access rules, in order:
          1. No project (caller should 404 separately) -> False.
          2. Legacy project (owner_username is NULL, predates ownership) ->
             any authenticated user keeps full access, matching old behaviour.
          3. The owner always has every permission.
          4. Otherwise, the user needs the permission via one of their roles.
        """
        if not project or not username:
            return False
        if project.get("owner_username") is None:
            return True
        if project["owner_username"] == username:
            return True
        return permission in MemberModel.permissions_for(project["id"], username)

    @staticmethod
    def effective_permissions(project: dict, username: str | None) -> list[str]:
        """Every permission `username` holds on `project` - used so the frontend
        can decide which management UI to show without guessing."""
        if not project or not username:
            return []
        if project.get("owner_username") is None or project["owner_username"] == username:
            return list(Permission.ALL)
        return list(MemberModel.permissions_for(project["id"], username))

    @staticmethod
    def visible_project_ids(all_projects: list[dict], username: str) -> set[int]:
        """Project ids `username` may at least view (owner, member, or legacy)."""
        with get_connection() as conn:
            member_of = {
                row["project_id"]
                for row in conn.execute(
                    "SELECT project_id FROM project_members WHERE username = ?", (username,)
                ).fetchall()
            }
        return {
            p["id"]
            for p in all_projects
            if p.get("owner_username") is None
            or p["owner_username"] == username
            or p["id"] in member_of
        }
