"""
Configuration tests.

The `test_config` argument to `create_app` has to actually win, because Phase 2
tests and any per-environment deployment will rely on it.
"""

from pathlib import Path


def test_relative_sqlite_uri_is_anchored_to_instance_folder():
    """A bare `sqlite:///name.db` must not land in the process working directory."""
    from app import create_app
    from app.config.settings import BACKEND_ROOT

    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///throwaway.db"})

    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    assert Path(uri.removeprefix("sqlite:///")).is_absolute()
    assert (BACKEND_ROOT / "instance" / "throwaway.db").as_posix() in uri
    assert Path(uri.removeprefix("sqlite:///")).parent.is_dir()


def test_absolute_sqlite_uri_is_preserved(tmp_path):
    from app import create_app

    target = tmp_path / "nested" / "app.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{target.as_posix()}"})

    assert app.config["SQLALCHEMY_DATABASE_URI"] == f"sqlite:///{target.as_posix()}"
    assert target.parent.is_dir()


def test_non_sqlite_uri_is_left_alone():
    """
    Phase 3+ may point at PostgreSQL; the app must not mkdir a URL-shaped path.

    Asserted against the helper rather than `create_app`, which builds the engine
    eagerly and would demand a PostgreSQL driver that Phase 1 does not install.
    """
    from app import _ensure_sqlite_parent

    uri = "postgresql://user:secret@db.internal:5432/ruchita"
    config = {"SQLALCHEMY_DATABASE_URI": uri}
    _ensure_sqlite_parent(config)

    assert config["SQLALCHEMY_DATABASE_URI"] == uri
    assert not Path("db.internal:5432").exists()


def test_testing_flag_from_environment_is_boolean():
    from app.config.settings import _as_bool

    assert _as_bool("RI_UNSET_VARIABLE_FOR_TESTS", False) is False
    assert _as_bool("RI_UNSET_VARIABLE_FOR_TESTS", True) is True

    import os

    os.environ["RI_BOOL_TRUE"] = "  YES "
    os.environ["RI_BOOL_FALSE"] = "0"
    try:
        assert _as_bool("RI_BOOL_TRUE", False) is True
        assert _as_bool("RI_BOOL_FALSE", True) is False
    finally:
        del os.environ["RI_BOOL_TRUE"]
        del os.environ["RI_BOOL_FALSE"]


# ---------------------------------------------------------------------------
# Production secret enforcement
# ---------------------------------------------------------------------------


def _verify_with_env(monkeypatch, **env):
    """
    Run `verify_production_secrets` against a synthetic environment.

    The check reads `os.environ` and the class attributes that were resolved from
    it, so both are patched: setting only the environment would leave the already
    imported `Settings` class holding the development values.
    """
    from app.config.settings import Settings

    for name, value in env.items():
        monkeypatch.setenv(name, value)
    for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
        if name not in env:
            monkeypatch.delenv(name, raising=False)

    monkeypatch.setattr(Settings, "IS_PRODUCTION", True, raising=False)
    for name, value in env.items():
        if name in ("SECRET_KEY", "JWT_SECRET_KEY"):
            monkeypatch.setattr(Settings, name, value, raising=False)

    Settings.verify_production_secrets()


def test_production_refuses_a_missing_secret_key(monkeypatch):
    """
    A missing key falls back to a per-process random value, so a production boot
    that reaches it invalidates every session on each restart. It must refuse.
    """
    import pytest

    with pytest.raises(RuntimeError, match="SECRET_KEY is not set"):
        _verify_with_env(monkeypatch, JWT_SECRET_KEY="b" * 64)


def test_production_refuses_a_placeholder_secret(monkeypatch):
    """`change-me` from `.env.example` is a public signing key."""
    import pytest

    with pytest.raises(RuntimeError, match="placeholder"):
        _verify_with_env(
            monkeypatch, SECRET_KEY="change-me", JWT_SECRET_KEY="b" * 64
        )


def test_production_requires_two_distinct_secrets(monkeypatch):
    """One key for both means a session-key rotation also forges tokens."""
    import pytest

    with pytest.raises(RuntimeError, match="identical"):
        _verify_with_env(
            monkeypatch, SECRET_KEY="a" * 64, JWT_SECRET_KEY="a" * 64
        )


def test_production_requires_a_long_enough_secret(monkeypatch):
    import pytest

    with pytest.raises(RuntimeError, match="at least 32 characters"):
        _verify_with_env(
            monkeypatch, SECRET_KEY="short", JWT_SECRET_KEY="b" * 64
        )


def test_production_accepts_two_proper_secrets(monkeypatch):
    _verify_with_env(monkeypatch, SECRET_KEY="a" * 64, JWT_SECRET_KEY="b" * 64)


def test_secret_check_is_a_no_op_outside_production(monkeypatch):
    """A fresh clone with no configuration must still boot for development."""
    from app.config.settings import Settings

    monkeypatch.setattr(Settings, "IS_PRODUCTION", False, raising=False)
    monkeypatch.setattr(Settings, "SECRET_KEY", "change-me", raising=False)
    monkeypatch.setattr(Settings, "JWT_SECRET_KEY", "change-me", raising=False)

    Settings.verify_production_secrets()


def test_empty_cors_origins_means_no_cross_origin_access(monkeypatch):
    """
    `CORS_ORIGINS=""` must produce an empty allow-list.

    It used to be resolved with `or`, which treats "" as unset and substituted the
    two localhost development origins — so the one value meaning "lock it down"
    could not be expressed.
    """
    import importlib

    monkeypatch.setenv("CORS_ORIGINS", "")
    monkeypatch.delenv("FRONTEND_URL", raising=False)

    from app.config import settings as settings_module

    reloaded = importlib.reload(settings_module)
    try:
        assert reloaded.settings.CORS_ORIGINS == ""
    finally:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        importlib.reload(settings_module)


def test_unset_cors_origins_still_defaults_to_the_dev_proxy(monkeypatch):
    import importlib

    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("FRONTEND_URL", raising=False)

    from app.config import settings as settings_module

    reloaded = importlib.reload(settings_module)
    assert "5173" in reloaded.settings.CORS_ORIGINS


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------


def test_security_headers_include_a_strict_csp(client):
    """
    §16: the app is same-origin and loads nothing external, so the policy can be
    strict. The point of it is the user-supplied text that flows through the whole
    product — client names, line descriptions, notes, terms.
    """
    csp = client.get("/api/v1/health").headers["Content-Security-Policy"]
    directives = {}
    for part in csp.split(";"):
        part = part.strip()
        if part:
            name, _, value = part.partition(" ")
            directives[name] = value

    assert directives["default-src"] == "'self'"
    assert directives["script-src"] == "'self'"
    # The one exemption, and only for styles: the print documents set computed
    # style properties at render time. Scripts get no such exemption.
    assert directives["style-src"] == "'self' 'unsafe-inline'"
    assert "unsafe-inline" not in directives["script-src"]
    assert "unsafe-eval" not in csp
    assert directives["frame-ancestors"] == "'none'"
    assert directives["object-src"] == "'none'"
    assert directives["base-uri"] == "'self'"
    # No form submits and no iframes anywhere in the app.
    assert directives["form-action"] == "'none'"
    # The API is same-origin and credentialed.
    assert directives["connect-src"] == "'self'"


def test_existing_security_headers_still_present(client):
    headers = client.get("/api/v1/health").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "same-origin"


def test_cross_origin_headers_are_set(client):
    headers = client.get("/api/v1/health").headers
    assert headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert headers["Cross-Origin-Resource-Policy"] == "same-origin"
    assert "camera=()" in headers["Permissions-Policy"]


def test_hsts_is_sent_in_production_only(client):
    """
    HSTS is meaningless over plain HTTP, and pinning a host that is reachable
    without TLS locks out the HTTP path entirely.
    """
    assert "Strict-Transport-Security" not in client.get("/api/v1/health").headers

    from app import create_app

    app = create_app({"TESTING": True, "IS_PRODUCTION": True})
    hsts = app.test_client().get("/api/v1/health").headers.get("Strict-Transport-Security")
    assert hsts is not None
    assert "max-age=31536000" in hsts


def test_csp_is_configurable(monkeypatch):
    """One setting, so the policy can be tightened without a code change."""
    from app import create_app

    app = create_app({"TESTING": True, "CONTENT_SECURITY_POLICY": "default-src 'none'"})
    assert (
        app.test_client().get("/api/v1/health").headers["Content-Security-Policy"]
        == "default-src 'none'"
    )


def test_proxy_fix_is_applied_only_when_trusting_proxy_headers():
    """
    Without ProxyFix, `request.url_scheme` is the proxy's `http` and
    `remote_addr` is the proxy's address for every request.
    """
    from app import create_app

    untrusted = create_app({"TESTING": True, "TRUST_PROXY_HEADERS": False})
    response = untrusted.test_client().get(
        "/api/v1/health", headers={"X-Forwarded-Proto": "https"}
    )
    assert response.status_code == 200

    trusted = create_app({"TESTING": True, "TRUST_PROXY_HEADERS": True, "TRUSTED_PROXY_COUNT": 1})

    @trusted.get("/scheme-under-test")
    def scheme():
        from flask import request

        return {"scheme": request.scheme, "remote": request.remote_addr, "host": request.host}

    client = trusted.test_client()
    assert client.get("/scheme-under-test").get_json()["scheme"] == "http"
    proxied = client.get(
        "/scheme-under-test",
        base_url="http://ruchita.example.test",
        headers={
            "X-Forwarded-Proto": "https",
            "X-Forwarded-For": "203.0.113.9",
            "X-Forwarded-Host": "ruchita.example.test",
        },
    )
    body = proxied.get_json()
    assert body["scheme"] == "https"
    assert body["remote"] == "203.0.113.9"
    assert body["host"] == "ruchita.example.test"
