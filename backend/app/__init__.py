"""
Ruchita Interiors — application factory.

Wires configuration, extensions, the API blueprint and the error handlers.

Phase 2 adds authentication (§16): JWT cookies, CSRF double-submit and the global
security headers. Security headers, session cookies and the CSRF guard all become
effective here now that there is a session to protect.
"""

import logging
import uuid
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate
from werkzeug.exceptions import HTTPException

from app.api import api_bp
from app.bootstrap import ensure_database_ready
from app.config.settings import BACKEND_ROOT, settings
from app.extensions.database import db, init_database
from app.spa import register_spa
from app.utils.errors import ApiError


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=False)
    app.config.from_object(settings)
    if test_config:
        app.config.update(test_config)

    _ensure_sqlite_parent(app)
    _configure_logging(app)

    # The allow-list is resolved once, here, from app.config. Flask-Cors only
    # supports a static list/pattern (not a callable), so `CORS_ORIGINS` is an
    # app-construction-time setting: pass it in `test_config` rather than
    # mutating `app.config` after the app exists.
    CORS(app, resources={r"/api/*": {"origins": _allowed_origins(app)}}, supports_credentials=True)

    init_database(app)
    Migrate(app, db)

    # After `Migrate(app, db)`: Alembic's runner reads the `migrate` extension off
    # the current app, so calling this earlier would fail on exactly the first boot
    # it exists to handle. A no-op unless AUTO_SEED_ADMIN is set, so the local
    # workflow and the test suite are unchanged.
    ensure_database_ready(app)

    app.register_blueprint(api_bp)
    _register_error_handlers(app)
    _register_request_hooks(app)
    _register_cli(app)

    # A built frontend, if one exists, takes over `/` and the client-side routes so
    # a single origin serves the whole app. It is a no-op without a build, which
    # is why the friendly API root below stays the behaviour in development and in
    # the test suite.
    spa_registered = register_spa(app)

    if not spa_registered:

        @app.get("/")
        def index():
            """Friendly root: point at the API instead of a bare 404."""
            return jsonify(
                {
                    "data": {
                        "service": "ruchita-interiors-api",
                        "api": f"{app.config['API_PREFIX']}/health",
                        "frontend": app.config["CORS_ORIGINS"],
                    }
                }
            )

    return app


def _register_cli(app: Flask) -> None:
    """
    Register `flask` CLI commands.

    Registered here rather than in `run.py` so the commands exist for every entry
    point - the dev server, the `flask db` migration runner and the tests all
    build the app through this factory.
    """
    from app.seed.seed_admin import seed_admin
    from app.seed.seed_defaults import seed_defaults

    app.cli.add_command(seed_admin)
    app.cli.add_command(seed_defaults)


def _allowed_origins(app: Flask) -> list[str]:
    """
    CORS allow-list, read from app.config so a per-app override actually applies.

    A comma-separated string is split, so one setting can carry production plus a
    staging host (§16). Empty entries are dropped rather than matching everything.
    """
    return [origin.strip() for origin in app.config["CORS_ORIGINS"].split(",") if origin.strip()]


def _ensure_sqlite_parent(app_or_config: Flask | dict) -> None:
    """
    Create the directory that holds the SQLite file, and anchor the URI to it.

    Accepts either a Flask app (to update `app.config`) or a plain dict (for
    unit testing). A bare `sqlite:///name.db` is rewritten to live under
    `backend/instance/`.
    """
    if isinstance(app_or_config, Flask):
        config = app_or_config.config
    else:
        config = app_or_config

    uri = config["SQLALCHEMY_DATABASE_URI"]
    if not uri.startswith("sqlite"):
        return

    path = Path(uri.removeprefix("sqlite:///"))
    if not path.is_absolute():
        path = Path(BACKEND_ROOT) / "instance" / path
    config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{path.as_posix()}"
    path.parent.mkdir(parents=True, exist_ok=True)


def _configure_logging(app: Flask) -> None:
    if not app.debug and not app.testing:
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _register_request_hooks(app: Flask) -> None:
    """Security headers on every response (§16)."""

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")

        # Auth responses carry credentials and must never be cached by a proxy or
        # the service worker.
        if request.path.startswith(f"{app.config['API_PREFIX']}/auth"):
            response.headers["Cache-Control"] = "no-store"

        return response

    @app.teardown_request
    def rollback_on_error(exception):
        """A failed request must not leave a half-written transaction open."""
        if exception is not None:
            from app.extensions.database import db

            db.session.rollback()


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        """Every deliberate failure already knows its envelope and status."""
        return jsonify(error.to_dict()), error.status

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        # Blueprint 404s arrive here too, which is what gives an unknown business
        # path the same structured 404 as a missing record.
        return (
            jsonify(
                {
                    "error": {
                        "code": _CODE_BY_STATUS.get(error.code, "INTERNAL"),
                        "message": error.description,
                        "details": [],
                    }
                }
            ),
            error.code or 500,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        # §16: a generic message to the client, full detail only in the log. The
        # id is echoed back so a user can quote it and it can be found in the log.
        error_id = uuid.uuid4().hex[:12]
        app.logger.exception("Unhandled error [%s] on %s %s", error_id, request.method, request.path)
        return (
            jsonify(
                {
                    "error": {
                        "code": "INTERNAL",
                        "message": "Something went wrong. Please try again.",
                        "details": [{"field": "error_id", "message": error_id}],
                    }
                }
            ),
            500,
        )


_CODE_BY_STATUS = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}
