import json
import os
import time

from config import Config
from models.auth import Auth


def init_auth() -> None:
    os.makedirs(Config.AUTH_DIR, exist_ok=True)

    for path in (Config.ACCOUNTS_PATH, Config.SESSIONS_PATH):
        if not os.path.exists(path):
            with open(path, "w") as f:
                json.dump({}, f)

    with open(Config.ACCOUNTS_PATH, "r") as f:
        Auth.accounts = json.load(f)

    with open(Config.SESSIONS_PATH, "r") as f:
        raw_sessions = json.load(f)

    # Older versions stored sessions as {session_id: username}. Any value
    # that isn't already the new {username, created_at} shape gets dropped
    # rather than crash the app - it just forces those sessions to log in
    # again, which is the same outcome as a normal expiry.
    Auth.sessions = {
        sid: entry
        for sid, entry in raw_sessions.items()
        if isinstance(entry, dict) and "username" in entry and "created_at" in entry
    }
    if Auth.sessions != raw_sessions:
        Auth.sessions_dirty = True

    Auth.handle_save()
