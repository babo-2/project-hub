import json
import os
import sqlite3
import tempfile
import zipfile
from contextlib import contextmanager
from datetime import datetime

from config import Config
from db.database import get_connection


def _parse_timestamp(filename: str) -> str | None:
    """'2026-08-19_14-30-05.db' -> '2026-08-19T14:30:05'. None if it doesn't parse."""
    stem = filename[:-3] if filename.endswith(".db") else filename
    for fmt in ("%Y-%m-%d_%H-%M-%S", "%Y-%m-%d_%H-%M"):  # older snapshots omit seconds
        try:
            return datetime.strptime(stem, fmt).isoformat()
        except ValueError:
            continue
    return None


class BackupBrowser:
    """
    Read-only access to old snapshots (and the daily zips older snapshots
    get rolled into), plus the ability to push chosen modules from a past
    snapshot back into the live database.
    """

    # -----------------------------------------------------------------
    # Listing
    # -----------------------------------------------------------------

    @staticmethod
    def list_sources() -> dict:
        snapshot_dir = Config.BACKUP_SNAPSHOT_DIR
        daily_dir = Config.BACKUP_DAILY_DIR

        snapshots = []
        if os.path.isdir(snapshot_dir):
            for name in sorted(os.listdir(snapshot_dir), reverse=True):
                if name.endswith(".db"):
                    snapshots.append({"name": name, "timestamp": _parse_timestamp(name)})

        daily = []
        if os.path.isdir(daily_dir):
            for zip_name in sorted(os.listdir(daily_dir), reverse=True):
                if not zip_name.endswith(".zip"):
                    continue
                day = zip_name[:-4]
                with zipfile.ZipFile(os.path.join(daily_dir, zip_name)) as zf:
                    entries = sorted(
                        [{"name": n, "timestamp": _parse_timestamp(n)} for n in zf.namelist()],
                        key=lambda e: e["name"],
                        reverse=True,
                    )
                daily.append({"day": day, "snapshots": entries})

        return {"snapshots": snapshots, "daily": daily}

    # -----------------------------------------------------------------
    # Opening a snapshot (from either location) as a read-only connection
    # -----------------------------------------------------------------

    @staticmethod
    @contextmanager
    def _open(kind: str, name: str, day: str | None = None):
        if kind == "snapshot":
            path = os.path.join(Config.BACKUP_SNAPSHOT_DIR, name)
            if not os.path.isfile(path):
                raise FileNotFoundError(name)
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()
            return

        if kind == "daily":
            zip_path = os.path.join(Config.BACKUP_DAILY_DIR, f"{day}.zip")
            if not os.path.isfile(zip_path):
                raise FileNotFoundError(day)
            with zipfile.ZipFile(zip_path) as zf:
                data = zf.read(name)  # raises KeyError if not present
            # sqlite needs a real file on disk, so extract to a scratch temp file
            fd, tmp_path = tempfile.mkstemp(suffix=".db")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                conn = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
                conn.row_factory = sqlite3.Row
                try:
                    yield conn
                finally:
                    conn.close()
            finally:
                os.remove(tmp_path)
            return

        raise ValueError(f"unknown source kind: {kind}")

    # -----------------------------------------------------------------
    # Diffing a project between "now" and a snapshot
    # -----------------------------------------------------------------

    @staticmethod
    def diff_project(kind: str, name: str, project_id: int, day: str | None = None) -> dict:
        with get_connection() as live_conn:
            live_project = live_conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            live_project = dict(live_project) if live_project else None
            live_modules = {
                m["id"]: {**dict(m), "data": json.loads(m["data"])}
                for m in live_conn.execute(
                    "SELECT * FROM modules WHERE project_id = ?", (project_id,)
                ).fetchall()
            }

        with BackupBrowser._open(kind, name, day) as snap_conn:
            snap_project_row = snap_conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            snap_project = dict(snap_project_row) if snap_project_row else None
            snap_modules = {
                m["id"]: {**dict(m), "data": json.loads(m["data"])}
                for m in snap_conn.execute(
                    "SELECT * FROM modules WHERE project_id = ?", (project_id,)
                ).fetchall()
            }

        all_ids = sorted(set(live_modules) | set(snap_modules))
        modules = [
            BackupBrowser._diff_entry(snap_modules.get(mid), live_modules.get(mid), [mid])
            for mid in all_ids
        ]

        project_changed = bool(snap_project) and bool(live_project) and (
            snap_project["name"] != live_project["name"]
            or snap_project["description"] != live_project["description"]
            or snap_project["color"] != live_project["color"]
        )

        return {
            "live_project": live_project,
            "snapshot_project": snap_project,
            "project_changed": project_changed,
            "modules": modules,
        }

    @staticmethod
    def _diff_entry(snap_item: dict | None, live_item: dict | None, path: list) -> dict:
        """
        Builds one diff-tree node for a module (or a folder child, which has
        the same {id, module_type, title, data} shape). Folders get a
        recursive `children` array so the UI can drill in and push
        individual nested items instead of only the folder as a whole.
        """
        if snap_item and not live_item:
            status = "add"             # only in the snapshot - pushing creates it
        elif live_item and not snap_item:
            status = "removed_since"   # only live - created after this snapshot, nothing to push
        else:
            changed = snap_item["data"] != live_item["data"] or snap_item["title"] != live_item["title"]
            status = "modify" if changed else "unchanged"

        base = snap_item or live_item
        entry = {
            "path": path,
            "title": base["title"],
            "module_type": base["module_type"],
            "status": status,
            "pushable": status in ("add", "modify"),
        }

        if base["module_type"] == "folder":
            snap_children = (snap_item["data"].get("children", []) if snap_item else [])
            live_children = (live_item["data"].get("children", []) if live_item else [])
            snap_by_id = {c["id"]: c for c in snap_children}
            live_by_id = {c["id"]: c for c in live_children}
            child_ids = list(dict.fromkeys([c["id"] for c in snap_children] + [c["id"] for c in live_children]))
            entry["children"] = [
                BackupBrowser._diff_entry(snap_by_id.get(cid), live_by_id.get(cid), [*path, cid])
                for cid in child_ids
            ]

        return entry

    @staticmethod
    def get_module_snapshot(kind: str, name: str, project_id: int, path: list, day: str | None = None) -> dict | None:
        with BackupBrowser._open(kind, name, day) as conn:
            row = conn.execute(
                "SELECT * FROM modules WHERE id = ? AND project_id = ?", (path[0], project_id)
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["data"] = json.loads(d["data"])

        # Descend into folder children for a nested path
        node = d
        for seg in path[1:]:
            children = node.get("data", {}).get("children", [])
            node = next((c for c in children if c["id"] == seg), None)
            if node is None:
                return None
        return node

    # -----------------------------------------------------------------
    # Pushing chosen modules (and optionally project metadata) into the
    # live database
    # -----------------------------------------------------------------

    @staticmethod
    def push(
        kind: str,
        name: str,
        project_id: int,
        paths: list[list] | str,
        include_project_meta: bool,
        day: str | None = None,
    ) -> dict:
        with BackupBrowser._open(kind, name, day) as snap_conn:
            snap_project = snap_conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            snap_modules_rows = snap_conn.execute(
                "SELECT * FROM modules WHERE project_id = ?", (project_id,)
            ).fetchall()
            snap_modules = {m["id"]: dict(m) for m in snap_modules_rows}

        if paths == "all":
            # Pushing every top-level module also brings every nested child
            # along for free, since a folder's whole (recursive) content
            # lives in its own single `data` blob.
            target_paths = [[mid] for mid in snap_modules.keys()]
        else:
            target_paths = [p for p in paths if p and p[0] in snap_modules]

        pushed = []
        with get_connection() as conn:
            if include_project_meta and snap_project:
                conn.execute(
                    """UPDATE projects SET name = ?, description = ?, color = ?,
                       updated_at = datetime('now') WHERE id = ?""",
                    (snap_project["name"], snap_project["description"], snap_project["color"], project_id),
                )

            # Group by top-level module id so several nested pushes into the
            # same folder are merged into a single UPDATE.
            by_top_level: dict[int, list[list]] = {}
            top_level_only: list[int] = []
            for path in target_paths:
                if len(path) == 1:
                    top_level_only.append(path[0])
                else:
                    by_top_level.setdefault(path[0], []).append(path[1:])

            for mid in top_level_only:
                m = snap_modules[mid]
                exists = conn.execute("SELECT 1 FROM modules WHERE id = ?", (mid,)).fetchone()
                if exists:
                    conn.execute(
                        """UPDATE modules SET title = ?, module_type = ?, data = ?,
                           position = ?, updated_at = datetime('now') WHERE id = ?""",
                        (m["title"], m["module_type"], m["data"], m["position"], mid),
                    )
                else:
                    conn.execute(
                        """INSERT INTO modules (id, project_id, module_type, title, data, position)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (mid, project_id, m["module_type"], m["title"], m["data"], m["position"]),
                    )
                pushed.append([mid])

            for top_id, sub_paths in by_top_level.items():
                live_row = conn.execute("SELECT * FROM modules WHERE id = ?", (top_id,)).fetchone()
                snap_row = snap_modules[top_id]
                snap_data = json.loads(snap_row["data"])

                if live_row:
                    live_data = json.loads(live_row["data"])
                else:
                    # The folder itself doesn't exist live yet - create it
                    # empty, then let the nested merge below populate it.
                    live_data = {"children": []}
                    conn.execute(
                        """INSERT INTO modules (id, project_id, module_type, title, data, position)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (top_id, project_id, snap_row["module_type"], snap_row["title"], json.dumps(live_data), snap_row["position"]),
                    )

                live_data.setdefault("children", [])
                for sub_path in sub_paths:
                    BackupBrowser._merge_nested(live_data["children"], snap_data.get("children", []), sub_path)
                    pushed.append([top_id, *sub_path])

                conn.execute(
                    "UPDATE modules SET data = ?, updated_at = datetime('now') WHERE id = ?",
                    (json.dumps(live_data), top_id),
                )

            conn.commit()

        return {"pushed_paths": pushed, "project_meta_pushed": include_project_meta}

    @staticmethod
    def _merge_nested(live_children: list, snap_children: list, path: list) -> None:
        """Mutates `live_children` in place, copying the node at `path`
        (relative to these children lists) from the snapshot side, creating
        any missing ancestor folders along the way."""
        target_id = path[0]
        snap_item = next((c for c in snap_children if c["id"] == target_id), None)
        if snap_item is None:
            return  # snapshot doesn't have this node - nothing to push

        idx = next((i for i, c in enumerate(live_children) if c["id"] == target_id), None)

        if len(path) == 1:
            if idx is not None:
                live_children[idx] = {
                    **live_children[idx],
                    "module_type": snap_item["module_type"],
                    "title": snap_item["title"],
                    "data": snap_item["data"],
                }
            else:
                live_children.append(json.loads(json.dumps(snap_item)))  # deep copy
            return

        if idx is None:
            # Ancestor folder doesn't exist live yet - bring in the whole
            # snapshot subtree at this position rather than only one leaf.
            live_children.append(json.loads(json.dumps(snap_item)))
            return

        live_children[idx].setdefault("data", {}).setdefault("children", [])
        BackupBrowser._merge_nested(
            live_children[idx]["data"]["children"],
            snap_item.get("data", {}).get("children", []),
            path[1:],
        )
