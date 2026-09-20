import json
from db.database import get_connection
from models.permissions import MemberModel


class InboxModel:
    """
    Per-user inbox. Invite-type messages are the only producer right now
    (created by members.invite_member); accepting one is what actually
    creates the project_members / member_roles rows.
    """

    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["payload"] = json.loads(d["payload"])
        return d

    @staticmethod
    def get_for_user(username: str) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM inbox_messages WHERE username = ? ORDER BY created_at DESC",
                (username,),
            ).fetchall()
            return [InboxModel._row_to_dict(r) for r in rows]

    @staticmethod
    def get_by_id(message_id: int) -> dict | None:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM inbox_messages WHERE id = ?", (message_id,)).fetchone()
            return InboxModel._row_to_dict(row) if row else None

    @staticmethod
    def unread_count(username: str) -> int:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM inbox_messages WHERE username = ? AND status = 'unread'",
                (username,),
            ).fetchone()
            return row["c"]

    @staticmethod
    def create(username: str, kind: str, type_: str, title: str, body: str = "", payload: dict | None = None) -> dict:
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO inbox_messages (username, kind, type, title, body, payload)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (username, kind, type_, title, body, json.dumps(payload or {})),
            )
            conn.commit()
            return InboxModel.get_by_id(cur.lastrowid)

    @staticmethod
    def has_pending_invite(username: str, project_id: int) -> bool:
        # Parsed in Python rather than via SQLite's json_extract, since JSON1
        # support varies across SQLite builds and this table stays small.
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT payload FROM inbox_messages WHERE username = ? AND type = 'invite' AND status = 'unread'",
                (username,),
            ).fetchall()
        return any(json.loads(r["payload"]).get("project_id") == project_id for r in rows)

    @staticmethod
    def mark_read(message_id: int) -> dict | None:
        with get_connection() as conn:
            conn.execute(
                "UPDATE inbox_messages SET status = 'read' WHERE id = ? AND status = 'unread'",
                (message_id,),
            )
            conn.commit()
        return InboxModel.get_by_id(message_id)

    @staticmethod
    def delete(message_id: int) -> bool:
        with get_connection() as conn:
            cur = conn.execute("DELETE FROM inbox_messages WHERE id = ?", (message_id,))
            conn.commit()
            return cur.rowcount > 0

    @staticmethod
    def decline(message_id: int) -> dict | None:
        with get_connection() as conn:
            conn.execute("UPDATE inbox_messages SET status = 'declined' WHERE id = ?", (message_id,))
            conn.commit()
        return InboxModel.get_by_id(message_id)

    @staticmethod
    def accept_invite(message: dict) -> dict:
        """Resolves an 'invite' message into real project membership."""
        project_id = message["payload"]["project_id"]
        role_ids = message["payload"].get("role_ids", [])
        member = MemberModel.add(project_id, message["username"])
        if member and role_ids:
            MemberModel.set_roles(member["id"], role_ids)

        with get_connection() as conn:
            conn.execute("UPDATE inbox_messages SET status = 'accepted' WHERE id = ?", (message["id"],))
            conn.commit()
        return InboxModel.get_by_id(message["id"])
