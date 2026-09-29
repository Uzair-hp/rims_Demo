"""
Ruchita Interiors — application settings.

Values come from the environment (see `.env.example`) with development-friendly
defaults, so a fresh clone runs with no configuration. Nothing here is secret: the
session key is generated per process in development and must be supplied in
production.

Phase 2 adds the authentication settings (§16). Two rules matter:

- `JWT_SECRET_KEY` must be distinct from `SECRET_KEY`, so rotating one does not
  silently invalidate the other. In production both are mandatory.
- `CORS_ORIGINS` replaces the Phase 1 `FRONTEND_URL`. The old name is still read
  as a fallback so an existing `.env` keeps working.
"""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_ROOT / ".env")


def _as_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


class Settings:
    """Application configuration resolved once at import time."""

    ENVIRONMENT = os.getenv("FLASK_ENV", "development")
    DEBUG = _as_bool("FLASK_DEBUG", ENVIRONMENT == "development")
    TESTING = _as_bool("FLASK_TESTING", False)

    IS_PRODUCTION = ENVIRONMENT == "production"

    SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)

    # A separate signing key for access/refresh tokens. Falling back to
    # SECRET_KEY keeps a fresh clone runnable, but they are generated distinctly
    # in `.env` so that a session-key rotation cannot invalidate live tokens.
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or SECRET_KEY
    JWT_ALGORITHM = "HS256"
    ACCESS_TOKEN_TTL_SECONDS = _as_int("ACCESS_TOKEN_TTL_SECONDS", 15 * 60)
    REFRESH_TOKEN_TTL_SECONDS = _as_int("REFRESH_TOKEN_TTL_SECONDS", 30 * 24 * 60 * 60)

    # CSRF double-submit (§16): a readable cookie plus a matching header.
    CSRF_COOKIE_NAME = "csrf_token"
    CSRF_HEADER_NAME = "X-CSRF-Token"
    CSRF_PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

    # Cookie names are prefixed so a plain-HTTP development session and a
    # Secure production session cannot overwrite each other in one browser.
    ACCESS_COOKIE_NAME = "ri_access" if not IS_PRODUCTION else "__Secure-ri_access"
    REFRESH_COOKIE_NAME = "ri_refresh" if not IS_PRODUCTION else "__Secure-ri_refresh"

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", f"sqlite:///{(BACKEND_ROOT / 'instance' / 'ruchita_interiors.db').as_posix()}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # §8.5 connection settings. WAL lets the dashboard read while a write is in
    # progress; foreign_keys is off by default in SQLite and must be set per
    # connection, otherwise the RESTRICT rules in §8.3 are silently ignored.
    SQLITE_JOURNAL_MODE = "WAL"
    SQLITE_BUSY_TIMEOUT_MS = 5000
    SQLITE_SYNCHRONOUS = "NORMAL"

    # Same-origin by default, so CORS is not needed for the standard dev setup: the
    # frontend uses a relative API base URL and the Vite dev server proxies /api.
    # Only a frontend served from a different origin requires an entry here, and
    # "localhost" and "127.0.0.1" must be listed separately - the browser treats
    # them as different origins *and* as different sites for SameSite cookies, so an
    # unlisted origin is silently blocked and surfaces as "Cannot reach the server".
    CORS_ORIGINS = os.getenv("CORS_ORIGINS") or os.getenv("FRONTEND_URL") or "http://localhost:5173,http://127.0.0.1:5173"

    # Seeded owner account (FR-A4). Consumed by `flask seed-admin`, never by a
    # request handler, so a password can never be changed through the API
    # without going through PUT /auth/password.
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Ruchita Interiors")

    # §16 password policy, enforced at seed time and on password change.
    PASSWORD_MIN_LENGTH = 10

    # §16 login rate limit: 5 attempts per 5 minutes per IP + email.
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS = _as_int("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 5)
    LOGIN_RATE_LIMIT_WINDOW_SECONDS = _as_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 5 * 60)

    # Off by default: `X-Forwarded-For` is client-controlled, so honouring it
    # without a known reverse proxy in front lets anyone spoof their IP and walk
    # around the login limit. Turn it on only when a proxy is deployed that sets
    # the header, and ideally narrow TRUSTED_PROXY_COUNT to match.
    TRUST_PROXY_HEADERS = _as_bool("TRUST_PROXY_HEADERS", False)
    TRUSTED_PROXY_COUNT = _as_int("TRUSTED_PROXY_COUNT", 1)

    # §15 Branding: the logo upload lands in `UPLOADS_DIR` (git-ignored), never in
    # the static folder, so a stored file is only ever served through the
    # authenticated API route rather than by the web server directly.
    UPLOADS_DIR = os.getenv("UPLOADS_DIR", str(BACKEND_ROOT / "uploads"))
    LOGO_SUBDIR = "branding"

    # §15/§16 upload policy: images only (PNG/JPEG/WEBP - SVG is rejected for XSS),
    # ≤ 2 MB, validated by extension + MIME + magic bytes, stored under a UUID name.
    LOGO_MAX_SIZE_BYTES = _as_int("LOGO_MAX_SIZE_BYTES", 2 * 1024 * 1024)
    LOGO_ALLOWED_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "webp"})
    LOGO_ALLOWED_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})

    API_PREFIX = "/api/v1"
    APP_VERSION = "1.0.0"
    PHASE = 7


settings = Settings()
