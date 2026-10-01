"""
Tests for the deployment-only single-page application hosting.

`app/spa.py` is what lets one Render Web Service serve both the API and the built
frontend, so the rules it has to honour are worth pinning:

- A deep client-side route (`/invoices/7`, `/print/invoice/7`) must return the SPA
  shell, not a 404. `createBrowserRouter` owns real URLs, so a hard refresh or a
  shared link hits the server directly.
- An unknown `/api/...` path must keep the JSON 404 envelope. If the fallback
  swallowed API paths, a typo would return HTML with a 200 and the client would
  report a parse failure instead of the real error.
- Registration is skipped with no build, and skipped while testing, so the rest of
  the suite is unaffected by whether someone has run `npm run build`.

Each test builds its own app with a throwaway dist directory, since the whole
feature is a function of what is on disk.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app import create_app
from app.extensions.database import db

_INDEX_HTML = "<!doctype html><html><body><div id=root></div></body></html>"


def _write_build(root, *, with_index: bool = True) -> None:
    """Lay out a minimal directory that looks like a Vite build."""
    (root / "assets").mkdir(parents=True, exist_ok=True)
    if with_index:
        (root / "index.html").write_text(_INDEX_HTML, encoding="utf-8")
    (root / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (root / "sw.js").write_text("// service worker", encoding="utf-8")


def _make_app(tmp_path, *, dist=None, with_index: bool = True, **overrides):
    """
    An app with SPA hosting resolved against a throwaway build directory.

    `TESTING` is deliberately not set: that flag is precisely what disables SPA
    registration, so the fixture would test nothing.
    """
    if dist is None:
        dist = tmp_path / "dist"
        _write_build(dist, with_index=with_index)

    db_path = tmp_path / "ruchita_spa_test.db"
    app = create_app(
        {
            "TESTING": False,
            "SECRET_KEY": "test",
            "JWT_SECRET_KEY": "test-jwt",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "SPA_DIST_DIR": str(dist),
            **overrides,
        }
    )

    with app.app_context():
        db.create_all()
    return app


@pytest.fixture()
def spa_client(tmp_path):
    app = _make_app(tmp_path)
    with app.app_context():
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def test_root_serves_the_spa_shell(spa_client):
    """`/` is the app, not the API's friendly JSON index."""
    response = spa_client.get("/")

    assert response.status_code == 200
    assert b'id=root' in response.data
    assert response.mimetype == "text/html"


def test_deep_client_route_serves_the_shell(spa_client):
    """
    A hard refresh on a client-side URL must not 404.

    `createBrowserRouter` owns `/invoices/7` and `/print/invoice/7`, and there is no
    such file on the server. Without the shell fallback, every shared link and
    every refresh mid-document would break while in-app navigation still worked.
    """
    for route in ("/invoices/7", "/print/invoice/7", "/clients/3/settings", "/anything/deep/here"):
        response = spa_client.get(route)
        assert response.status_code == 200, route
        assert b'id=root' in response.data, route


def test_built_asset_is_served_with_a_long_cache(spa_client):
    """Fingerprinted names are immutable, so they must not revalidate every load."""
    response = spa_client.get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert response.data == b"console.log(1)"
    assert "max-age=31536000" in response.headers["Cache-Control"]


def test_service_worker_revalidates(spa_client):
    """
    `sw.js` must not be cached for a year, or a deploy would never reach the
    installed PWA and `registerType: autoUpdate` would have nothing to find.
    """
    response = spa_client.get("/sw.js")

    assert response.status_code == 200
    assert "max-age=31536000" not in response.headers["Cache-Control"]


def test_index_html_revalidates(spa_client):
    """A cached shell with a stale asset manifest is the classic stale-deploy bug."""
    response = spa_client.get("/index.html")

    assert response.status_code == 200
    assert "max-age=31536000" not in response.headers["Cache-Control"]


def test_unknown_api_path_keeps_the_json_404(spa_client):
    """The API prefix is never served the shell; a typo must still be a JSON error."""
    response = spa_client.get("/api/v1/not-a-real-endpoint")

    assert response.status_code == 404
    assert response.mimetype == "application/json"
    error = response.get_json()["error"]
    assert error["code"] == "NOT_FOUND"


def test_api_prefix_itself_is_not_the_spa(spa_client):
    """`/api/v1` and its children belong to the API, shell or not."""
    response = spa_client.get("/api/v1")

    assert response.status_code == 404
    assert response.mimetype == "application/json"


def test_health_still_answers_json(spa_client):
    """The Render health check must keep returning JSON, not the shell."""
    response = spa_client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.get_json()["data"]["status"] == "ok"


def test_known_api_routes_are_untouched(spa_client):
    """A real endpoint must not be shadowed by the catch-all route."""
    response = spa_client.post("/api/v1/auth/login", json={"email": "x", "password": "y"})

    # 422 (missing csrf) or 401 - either proves the blueprint answered, not the shell.
    assert response.mimetype == "application/json"
    assert response.status_code != 200


def test_no_build_means_api_only(tmp_path):
    """Without a build there is nothing to serve, so `/` stays the friendly JSON root."""
    dist = tmp_path / "dist"
    _write_build(dist, with_index=False)

    app = _make_app(tmp_path, dist=dist)
    with app.test_client() as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.get_json()["data"]["service"] == "ruchita-interiors-api"
    # A deep link now 404s, which is correct: there is no SPA to bootstrap.
    assert client.get("/invoices/7").status_code == 404


def test_missing_dist_directory_is_a_no_op(tmp_path):
    """A configured but absent directory must not break start-up."""
    dist = tmp_path / "dist"
    _write_build(dist)

    app = _make_app(tmp_path, dist=dist, SPA_DIST_DIR=str(tmp_path / "nope"))
    with app.test_client() as client:
        response = client.get("/")

    assert response.get_json()["data"]["service"] == "ruchita-interiors-api"


def test_testing_flag_disables_spa_registration(tmp_path):
    """
    The suite's own fixture sets `TESTING`, so SPA hosting stays out of the way.

    Pinned because it is what makes every other test in this file meaningful: a
    developer who had run `npm run build` must not change what `pytest` sees.
    """
    dist = tmp_path / "dist"
    _write_build(dist)

    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'flag.db').as_posix()}",
            "SPA_DIST_DIR": str(dist),
        }
    )
    with app.test_client() as client:
        response = client.get("/")

    assert response.get_json()["data"]["service"] == "ruchita-interiors-api"


def test_path_traversal_does_not_escape_the_build(spa_client):
    """A crafted path must not read outside the build directory."""
    response = spa_client.get("/../../../../etc/passwd")

    # Either Flask normalises it away or the fallback returns the shell; what must
    # never happen is the contents of a file outside the build.
    assert b"root:" not in response.data


# ---------------------------------------------------------------------------
# CSP vs. the real build
# ---------------------------------------------------------------------------


def _real_dist() -> Path:
    """The actual `frontend/dist`, not the throwaway fixture layout."""
    from app.config.settings import BACKEND_ROOT

    return BACKEND_ROOT.parent / "frontend" / "dist"


@pytest.fixture()
def real_build_client(tmp_path):
    """
    An app serving the *real* Vite build, or skipping when there isn't one.

    `spa_client` writes a synthetic `index.html` that could never violate a CSP,
    so it proves nothing about the policy. These checks are only meaningful against
    the file a browser actually receives, which means the artefact `npm run build`
    produced. Skipping rather than failing when it is absent keeps a backend-only
    checkout's test run honest.
    """
    dist = _real_dist()
    if not (dist / "index.html").is_file():
        pytest.skip("no frontend build present; run `npm run build` to check this")

    app = _make_app(tmp_path, dist=dist)
    with app.app_context():
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def _directives(csp: str) -> dict[str, set[str]]:
    parsed: dict[str, set[str]] = {}
    for part in csp.split(";"):
        part = part.strip()
        if not part:
            continue
        tokens = part.split()
        parsed[tokens[0]] = set(tokens[1:])
    return parsed


def _allows(directives: dict[str, set[str]], name: str, value: str) -> bool:
    """Would `value` be permitted by `name`, falling back to `default-src`?

    Only the two forms this app actually emits are judged: a same-origin path,
    and an explicit scheme/host allow-list entry. An unrecognised form is treated
    as blocked, so a future off-origin dependency fails the test rather than
    quietly passing an `_allows` check that never considered it.
    """
    effective = directives.get(name) or directives.get("default-src") or set()
    if value in effective:
        return True
    same_origin = value.startswith(("/", "./", "../")) or not value.startswith(("http:", "https:", "//"))
    return same_origin and "'self'" in effective


def test_the_real_build_has_no_inline_script(real_build_client):
    """
    The shipped `index.html` must contain no inline `<script>`.

    The CSP sets `script-src 'self'` with no `'unsafe-inline'` and no hash, so a
    single inline block is a total application failure: React never boots and the
    user sees a blank page with no error. That is the whole reason the pre-paint
    theme script lives in `public/theme-boot.js` instead.
    """
    html = (Path(real_build_client.application.config["SPA_DIST_DIR"]) / "index.html").read_text(
        encoding="utf-8"
    )
    # A `<script>` with a `src` is fine; one with content between the tags is not.
    for tag in re.findall(r"<script\b[^>]*>(.*?)</script>", html, re.DOTALL | re.IGNORECASE):
        assert not tag.strip(), f"inline <script> in the built index.html: {tag[:80]!r}"


def test_every_script_in_the_real_build_is_same_origin(real_build_client):
    """No script may point off-origin — `script-src 'self'` would block it."""
    html = (Path(real_build_client.application.config["SPA_DIST_DIR"]) / "index.html").read_text(
        encoding="utf-8"
    )
    sources = re.findall(r"<script\b[^>]*\bsrc=[\"']([^\"']+)[\"']", html, re.IGNORECASE)
    assert sources, "the built index.html loads no scripts at all, which cannot be right"
    for src in sources:
        assert src.startswith(("/", "./")), f"script src {src!r} is not same-origin"


def test_the_csp_permits_what_the_real_build_loads(real_build_client):
    """
    Walk the built `index.html` against the policy the app actually sends.

    A CSP that is merely strict is not the same as a CSP that is correct: one
    directive too tight and the app is blank, with nothing in the test suite or
    the server logs to say why. Each resource type the shell references is checked
    against the directive that governs it, using the header from a real response.
    """
    response = real_build_client.get("/")
    directives = _directives(response.headers["Content-Security-Policy"])
    html = (Path(real_build_client.application.config["SPA_DIST_DIR"]) / "index.html").read_text(
        encoding="utf-8"
    )

    def links(rel: str) -> list[str]:
        pattern = rf"<link\b[^>]*\brel=[\"']{rel}[\"'][^>]*\bhref=[\"']([^\"']+)[\"']"
        return re.findall(pattern, html, re.IGNORECASE)

    # The module entry point, the theme bootstrap and the service-worker
    # registration — every one governed by script-src.
    scripts = re.findall(r"<script\b[^>]*\bsrc=[\"']([^\"']+)[\"']", html, re.IGNORECASE)
    assert scripts
    for src in scripts:
        assert _allows(directives, "script-src", src), f"script-src blocks {src}"

    for href in links("stylesheet"):
        assert _allows(directives, "style-src", href), f"style-src blocks {href}"

    # The manifest, which `manifest-src` governs.
    for href in links("manifest"):
        assert _allows(directives, "manifest-src", href), f"manifest-src blocks {href}"

    # Icons, which `img-src` governs.
    icons = links("icon") + links("apple-touch-icon")
    assert icons, "the built index.html declares no icons"
    for href in icons:
        assert _allows(directives, "img-src", href), f"img-src blocks {href}"

    # The API is same-origin and credentialed.
    assert _allows(directives, "connect-src", "/api/v1/health")
    # The service worker, without which the app is not installable.
    assert _allows(directives, "worker-src", "/sw.js")


def test_the_spa_shell_carries_the_csp(real_build_client):
    """
    The policy has to reach the HTML document, not just the API responses.

    A CSP on `application/json` protects nothing: the document is what loads the
    scripts, and it is the document's own policy that governs them.
    """
    response = real_build_client.get("/")

    assert response.mimetype == "text/html"
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
