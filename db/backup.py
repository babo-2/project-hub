"""
Backup backends.

To add a new backend (e.g. S3, Google Drive, rsync):
  1. Subclass BackupBackend and implement `run()`.
  2. Set BACKUP_ENABLED = True and point `active_backend` to your class.

Nothing else in the codebase needs to change.
"""

import os
import shutil
import zipfile
from abc import ABC, abstractmethod
from datetime import datetime

from config import Config
from db.database import get_connection


class BackupBackend(ABC):
    @abstractmethod
    def run(self) -> str:
        """Execute the backup. Return a human-readable destination string."""


class LocalFileBackup(BackupBackend):
    """Copies the SQLite file to a timestamped file in BACKUP_SNAPSHOT_DIR."""

    def run(self) -> str:
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        dest = os.path.join(Config.BACKUP_SNAPSHOT_DIR, f"{timestamp}.db")
        shutil.copy2(Config.DB_PATH, dest)
        return dest


# ---------------------------------------------------------------------------
# Active backend — change this line to swap storage
# ---------------------------------------------------------------------------
active_backend: BackupBackend = LocalFileBackup()


def run_backup() -> dict:
    """Run the active backup backend, log the result, then roll off old snapshots."""
    if not Config.BACKUP_ENABLED:
        return {"status": "disabled", "destination": "none"}

    try:
        dest = active_backend.run()
        status = "ok"
    except Exception as exc:
        dest = str(exc)
        status = "error"

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO backup_log (destination, status) VALUES (?, ?)",
            (dest, status),
        )

    if status == "ok":
        _consolidate_old_snapshots()

    return {"status": status, "destination": dest}


def init_backup() -> None:
    """Ensure backup directories exist. Safe to call on every startup."""
    os.makedirs(Config.BACKUP_SNAPSHOT_DIR, exist_ok=True)
    os.makedirs(Config.BACKUP_DAILY_DIR, exist_ok=True)
    _consolidate_old_snapshots()


def _consolidate_old_snapshots() -> None:
    """
    Keep at most BACKUP_MAX_SNAPSHOTS individual snapshot files. Anything
    older than that gets rolled into a per-day zip archive instead of being
    deleted outright, so history is preserved but the snapshots folder
    doesn't grow forever.
    """
    snapshot_dir = Config.BACKUP_SNAPSHOT_DIR
    backups = sorted(f for f in os.listdir(snapshot_dir) if f.endswith(".db"))

    if len(backups) <= Config.BACKUP_MAX_SNAPSHOTS:
        return

    remove_count = len(backups) - Config.BACKUP_MAX_SNAPSHOTS
    old_backups = backups[:remove_count]

    by_day: dict[str, list[str]] = {}
    for file in old_backups:
        day = file.split("_")[0]
        by_day.setdefault(day, []).append(file)

    for day, files in by_day.items():
        output_file = os.path.join(Config.BACKUP_DAILY_DIR, f"{day}.zip")
        with zipfile.ZipFile(output_file, "a", zipfile.ZIP_DEFLATED) as zip_file:
            existing = set(zip_file.namelist())
            for file in files:
                if file in existing:
                    os.remove(os.path.join(snapshot_dir, file))
                    continue
                path = os.path.join(snapshot_dir, file)
                zip_file.write(path, arcname=file)
                os.remove(path)
