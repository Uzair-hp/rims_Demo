"""
Ruchita Interiors — database extension.

The SQLAlchemy instance is created and bound here. The first model (`users`)
arrives with authentication in Phase 2 and the full schema in Phase 3 (PLAN §24).

No schema is created at startup: Alembic owns every DDL change (§8.1), so
`create_all()` is never called. That is why `/health` can report "ok" without
needing a database.

SQLite is the permanent production database (§8.5), and it is not configured to
its defaults out of the box. Three of the settings below are opt-in and must be
applied per connection:

- `foreign_keys` is OFF unless set, which would silently ignore every `RESTRICT`
  rule in §8.3 and allow orphaned financial records.
- WAL allows readers to continue during a write instead of raising "database is
  locked".
- `busy_timeout` makes a contended write wait rather than fail immediately.
"""

import sqlite3

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.config.settings import settings

db = SQLAlchemy()

_PRAGMAS_REGISTERED = False


def _apply_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """
    Apply the §8.5 pragmas to one new SQLite connection.

    `journal_mode` is persistent in the database file, but `foreign_keys`,
    `synchronous` and `busy_timeout` are per-connection, so this has to run for
    every connection rather than once at startup.
    """
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return

    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={settings.SQLITE_BUSY_TIMEOUT_MS}")
        # `journal_mode` returns a row and fails on a read-only or memory
        # database, so it is best-effort: losing WAL degrades concurrency but
        # must never prevent the app from starting.
        try:
            cursor.execute(f"PRAGMA journal_mode={settings.SQLITE_JOURNAL_MODE}")
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute(f"PRAGMA synchronous={settings.SQLITE_SYNCHRONOUS}")
        except sqlite3.OperationalError:
            pass
    finally:
        cursor.close()


def init_database(app) -> None:
    """Attach the extension to an application, registering pragmas exactly once."""
    global _PRAGMAS_REGISTERED

    db.init_app(app)

    if not _PRAGMAS_REGISTERED:
        # Engine-level rather than app-level, so the Alembic runner and the test
        # database get the same settings as the development server.
        event.listen(Engine, "connect", _apply_sqlite_pragmas)
        _PRAGMAS_REGISTERED = True
