import os
import secrets


class Config:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    TEMPLATES_AUTO_RELOAD = True

    # --- Database ---
    DB_PATH = os.path.join(BASE_DIR, "data", "hub.db")

    # --- Backup (stub: swap class in backup.py to change backend) ---
    BACKUP_ENABLED = True
    BACKUP_DIR = os.path.join(BASE_DIR, "data", "backups")
    BACKUP_SNAPSHOT_DIR = os.path.join(BACKUP_DIR, "snapshots")
    BACKUP_DAILY_DIR = os.path.join(BACKUP_DIR, "daily")
    BACKUP_DEBOUNCE_SECONDS = 10 * 60      # wait this long after a change before snapshotting
    BACKUP_MAX_SNAPSHOTS = 10              # snapshots beyond this get rolled into a daily zip

    # --- Auth ---
    AUTH_DIR = os.path.join(BASE_DIR, "data", "auth")
    ACCOUNTS_PATH = os.path.join(AUTH_DIR, "accounts.json")
    SESSIONS_PATH = os.path.join(AUTH_DIR, "sessions.json")
    CAN_REGISTER = False
    SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60  # sessions auto-expire after 7 days

    # SECRET_KEY must come from the environment. Without it, Flask signs
    # session cookies with a key anyone could forge, which lets an attacker
    # log in as any user. If it's missing we generate a random one for this
    # process only, so the app still starts, but every existing session is
    # invalidated on every restart. Set SECRET_KEY in your environment for
    # sessions that survive a restart.
    SECRET_KEY = os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        SECRET_KEY = secrets.token_hex(32)
        print(
            "[config] WARNING: SECRET_KEY is not set in the environment. "
            "Using a random key for this run only \u2014 all sessions will be "
            "invalidated on restart. Set the SECRET_KEY env var to avoid this."
        )

    # --- Server ---
    HOST = "localhost"#"0.0.0.0"
    PORT = 5000
    DEBUG = False
