from db.database import get_connection
from db.backup import run_backup
from threading import Timer
from config import Config

class BackupManager:
    IS_DIRTY=False
    @staticmethod
    def modify():
        if not BackupManager.IS_DIRTY:
            BackupManager.IS_DIRTY=True

            timer = Timer(Config.BACKUP_DEBOUNCE_SECONDS, BackupManager.backup)
            timer.daemon = True  # don't block process shutdown on a pending backup
            timer.start()

    @staticmethod
    def backup():
        resp = run_backup()
        BackupManager.IS_DIRTY=False
        print("BACKUP: " + str(resp["status"]) + " - " + str(resp["destination"]))

