import hashlib
import hmac
import json
import os
import threading
import time

from config import Config


def derive_key(password: bytes, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations, dklen=32)


class Auth:
    """
    In-memory accounts/sessions, periodically flushed to disk.

    All reads and writes to `accounts` / `sessions` go through `_lock` so
    concurrent requests (Flask's dev server is threaded) can't corrupt
    either dict or clobber each other's writes.
    """

    accounts: dict[str, dict[str, str]] = {}   # username -> {password, salt, iterations}
    sessions: dict[str, dict] = {}              # session_id -> {username, created_at}

    accounts_dirty: bool = False
    sessions_dirty: bool = False
    save_interval: int = 5   # sec
    _save_thread_started = False
    _lock = threading.RLock()

    # -----------------------------------------------------------------
    # Login / register / logout
    # -----------------------------------------------------------------

    @staticmethod
    def login(username: str, password: str) -> bool:
        with Auth._lock:
            acc = Auth.accounts.get(username)
        if not acc:
            return False
        candidate = derive_key(
            password.encode("utf-8"), bytes.fromhex(acc["salt"]), acc["iterations"]
        ).hex()
        return hmac.compare_digest(candidate, acc["password"])

    @staticmethod
    def register(username: str, password: str) -> bool:
        with Auth._lock:
            if username in Auth.accounts:
                return False
            salt = os.urandom(32)
            iterations = 600_000
            password_hash = derive_key(password.encode("utf-8"), salt, iterations).hex()
            Auth.accounts[username] = {
                "password": password_hash,
                "salt": salt.hex(),
                "iterations": iterations,
            }
            Auth.accounts_dirty = True
            return True

    @staticmethod
    def logout(session_id: str) -> bool:
        with Auth._lock:
            if session_id in Auth.sessions:
                del Auth.sessions[session_id]
                Auth.sessions_dirty = True
                return True
            return False

    # -----------------------------------------------------------------
    # Sessions
    # -----------------------------------------------------------------

    @staticmethod
    def generate_session_id(username: str) -> str:
        session_id = os.urandom(32).hex()
        with Auth._lock:
            Auth.sessions[session_id] = {"username": username, "created_at": time.time()}
            Auth.sessions_dirty = True
        return session_id

    @staticmethod
    def validate_session(session_id: str | None, username: str | None) -> bool:
        """
        True if `session_id` is a live session belonging to `username`.
        Expired sessions are deleted as a side effect of being checked.
        """
        if not session_id or not username:
            return False
        with Auth._lock:
            entry = Auth.sessions.get(session_id)
            if not entry:
                return False
            if entry["username"] != username:
                return False
            age = time.time() - entry["created_at"]
            if age > Config.SESSION_LIFETIME_SECONDS:
                del Auth.sessions[session_id]
                Auth.sessions_dirty = True
                return False
            return True

    # -----------------------------------------------------------------
    # Persistence
    # -----------------------------------------------------------------

    @staticmethod
    def handle_save() -> None:
        if Auth._save_thread_started:
            return
        Auth._save_thread_started = True

        def handler():
            while True:
                time.sleep(Auth.save_interval)
                Auth.save()

        thread = threading.Thread(target=handler, daemon=True)
        thread.start()

    @staticmethod
    def save() -> None:
        with Auth._lock:
            if Auth.accounts_dirty:
                with open(Config.ACCOUNTS_PATH, "w") as f:
                    json.dump(Auth.accounts, f)
                Auth.accounts_dirty = False

            if Auth.sessions_dirty:
                with open(Config.SESSIONS_PATH, "w") as f:
                    json.dump(Auth.sessions, f)
                Auth.sessions_dirty = False
