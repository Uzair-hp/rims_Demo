"""
Ruchita Interiors — single-page application hosting (deployment only).

`create_app` calls `register_spa` so that one origin serves both the API and the
built React app. That is what lets the production deployment be a single Web
Service: the frontend keeps its relative `VITE_API_BASE_URL`, so every call stays
same-origin, the `SameSite=Lax` auth cookies behave as they do in development
behind the Vite proxy, and no CORS origin has to be registered.

Two rules keep this from leaking into the API contract:

- **The API prefix is never touched.** A missing `/api/...` path must still answer
  with the JSON 404 envelope from `utils.errors`, not `index.html`. A SPA fallback
  that swallowed unknown API paths would turn every typo into an HTML 200.
- **No-op without a build.** Registration is skipped when `index.html` is absent
  or the app is testing, so the test suite and a bare `flask run` keep the
  API-only behaviour they were written against. Nothing here is exercised locally
  unless someone has run `npm run build`.

Caching follows the build's own contract: Vite fingerprints filenames under
`assets/`, so those are immutable and cached for a year, while `index.html` and
the service worker must revalidate or a new deploy would be served the previous
shell with a stale precache manifest.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, abort, send_from_directory

# Vite emits content-hashed names here, so the contents can never change under a
# given URL. Everything else (index.html, sw.js, manifest.webmanifest, icons) has
# to revalidate.
_IMMUTABLE_PREFIX = "assets/"

# Fingerprinted build output: safe to cache for a year.
_IMMUTABLE_MAX_AGE = 31536000

# Shell files that must be revalidated on every load. Not `no-store`: the service
# worker needs to read sw.js, and a cached index.html is exactly how a deploy goes
# unnoticed.
_REVALIDATE_MAX_AGE = 0


def register_spa(app: Flask) -> bool:
    """
    Serve `SPA_DIST_DIR` from this app. Returns whether it registered anything.

    Called unconditionally by `create_app`; decides for itself whether a built
    frontend exists, so the test suite and local API-only runs are unaffected.
    """
    dist = _resolve_dist(app)
    if dist is None:
        return False

    dist_root = dist.resolve()

    def _is_api_path(path: str) -> bool:
        """
        True for anything the API owns, including its 404s.

        The catch-all's `path` parameter arrives *without* a leading slash (that is
        how the URL converter hands it over), so the prefix is matched against a
        re-anchored copy. Comparing `path` directly would never match
        `/api/v1/...` and every unknown endpoint would silently get the shell.
        """
        prefix = app.config["API_PREFIX"]
        candidate = f"/{path}"
        return candidate == prefix or candidate.startswith(f"{prefix}/")

    def _send(path: str):
        """
        Serve a built file, or the SPA shell for a client-side route.

        `send_from_directory` already rejects traversal, so this is belt and braces:
        the resolved target is checked against the build root before it is read, and
        anything that is not a real file inside the build falls through to the
        shell rather than being served.
        """
        target = (dist_root / path).resolve()
        if not target.is_relative_to(dist_root) or not target.is_file():
            return send_from_directory(dist, "index.html", max_age=_REVALIDATE_MAX_AGE)
        max_age = _IMMUTABLE_MAX_AGE if path.startswith(_IMMUTABLE_PREFIX) else _REVALIDATE_MAX_AGE
        return send_from_directory(dist, path, max_age=max_age)

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str):
        """
        Serve the SPA: a built file when one matches, the shell otherwise.

        The shell fallback is not a convenience. `createBrowserRouter` owns real
        URLs (`/invoices/7`, `/print/invoice/7`), so a hard refresh or a shared
        link hits the server directly with no `index.html` to bootstrap. Without
        this, every deep link would 404 while client-side navigation worked.
        """
        if path == "":
            return send_from_directory(dist, "index.html", max_age=_REVALIDATE_MAX_AGE)
        if _is_api_path(path):
            # Let the API's own 404 handler produce the envelope, so an unknown
            # endpoint still looks like an API error to the client.
            abort(404)
        return _send(path)

    app.logger.info("Serving the built frontend from %s", dist)
    return True


def _resolve_dist(app: Flask) -> Path | None:
    """
    The directory to serve, or None when there is nothing to serve.

    Testing is excluded explicitly: the suite asserts the API-only behaviour, and
    a developer who happens to have run `npm run build` locally should not change
    what `pytest` sees.
    """
    if app.config.get("TESTING"):
        return None

    configured = app.config.get("SPA_DIST_DIR")
    if not configured:
        return None

    dist = Path(configured)
    return dist if (dist / "index.html").is_file() else None
