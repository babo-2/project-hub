from flask import Flask
from flask_cors import CORS

from config import Config
from db.database import init_db
from db.backup import init_backup
from db.auth import init_auth
from routes.projects import projects_bp
from routes.modules import modules_bp
from routes.members import members_bp
from routes.backups import backups_bp
from routes.search import search_bp
from routes.inbox import inbox_bp
from routes.frontend import frontend_bp
from routes.auth import auth_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="frontend")
    app.config.from_object(Config)

    CORS(app)

    # Initialise DB on startup (idempotent)
    init_db()
    init_backup()
    init_auth()

    # Register route blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(modules_bp)
    app.register_blueprint(members_bp)
    app.register_blueprint(backups_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(inbox_bp)
    app.register_blueprint(frontend_bp)

    return app


if __name__ == "__main__":
    app = create_app()
    context = ('cert/cert.pem', 'cert/key.pem')
    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG, ssl_context=context)
