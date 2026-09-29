"""
Phase 3 logo upload tests.

Mapped to PLAN §25 Phase 3: a small PNG uploads; SVG and an oversized file are
rejected with clear per-field errors; the stored file is served back; delete
removes both the file and the reference.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.models import CompanySettings


def _png_bytes(size_px: tuple = (4, 4), color=(201, 162, 75)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size_px, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _upload(client, data: bytes, filename: str, mimetype: str):
    header = _csrf(client)
    return client.post(
        "/api/v1/settings/logo",
        data={"logo": (io.BytesIO(data), filename, mimetype)},
        content_type="multipart/form-data",
        headers=header,
    )


def _csrf(client) -> dict:
    client.get("/api/v1/auth/csrf")
    token = next(
        (c.value for k, c in getattr(client, "_cookies", {}).items() if isinstance(k, tuple) and k[2] == "csrf_token"),
        "",
    )
    return {"X-CSRF-Token": token}


@pytest.fixture
def authed_client(client):
    from app.extensions.database import db
    from app.models import User

    with client.application.app_context():
        user = User(email="owner@test.local", name="Owner", role="owner", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    token = _csrf(client)["X-CSRF-Token"]
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@test.local", "password": "password-123456"},
        headers={"X-CSRF-Token": token},
    )
    assert login.status_code == 200
    return client


def test_png_upload_succeeds_and_is_served(authed_client):
    response = _upload(authed_client, _png_bytes(), "logo.png", "image/png")
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["data"]["logo_path"].endswith(".png")

    served = authed_client.get("/api/v1/uploads/logo")
    assert served.status_code == 200
    assert served.headers["Content-Type"].startswith("image/png")
    assert served.headers["Cache-Control"].startswith("public")
    assert bytes(served.data).startswith(b"\x89PNG")


def test_svg_upload_is_rejected_with_clear_error(authed_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    response = _upload(authed_client, svg, "logo.svg", "image/svg+xml")

    assert response.status_code == 422
    error = response.get_json()["error"]
    assert "SVG" in error["message"] or "PNG" in error["message"]
    assert error["details"][0]["field"] == "logo"


def test_oversize_upload_is_rejected(authed_client):
    """A valid PNG above the 2 MB cap must be rejected with a clear message."""
    cap = 2 * 1024 * 1024
    # A noise-heavy image at this size compresses far past the cap, which keeps
    # the test honest: the file is a real decodable PNG, just too large.
    import os
    import random

    random.seed(7)
    image = Image.new("RGB", (1600, 1600))
    image.putdata([(random.randrange(256), random.randrange(256), random.randrange(256)) for _ in range(1600 * 1600)])
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False)
    big = buffer.getvalue()
    assert len(big) > cap, "test could not build an oversize image"

    response = _upload(authed_client, big, "big.png", "image/png")
    assert response.status_code == 422
    error = response.get_json()["error"]
    assert "MB" in error["message"]
    assert error["details"][0]["field"] == "logo"


def test_forged_extension_is_rejected_by_magic_bytes(authed_client):
    """A text file renamed .png must not pass the content sniff (§16)."""
    response = _upload(authed_client, b"definitely not an image", "evil.png", "image/png")

    assert response.status_code == 422


def test_missing_file_is_rejected(authed_client):
    header = _csrf(authed_client)
    response = authed_client.post(
        "/api/v1/settings/logo", data={}, content_type="multipart/form-data", headers=header
    )
    assert response.status_code == 422


def test_delete_removes_file_and_reference(authed_client):
    uploaded = _upload(authed_client, _png_bytes(), "logo.png", "image/png")
    logo_path = uploaded.get_json()["data"]["logo_path"]

    deleted = authed_client.delete("/api/v1/settings/logo", headers=_csrf(authed_client))
    assert deleted.status_code == 200

    row = CompanySettings.get_row()
    assert row.logo_path is None
    from pathlib import Path

    from flask import current_app

    with authed_client.application.app_context():
        stored = Path(current_app.config["UPLOADS_DIR"]) / logo_path
        assert not stored.exists()


def test_serving_without_logo_is_404(authed_client):
    response = authed_client.get("/api/v1/uploads/logo")
    assert response.status_code == 404


def test_logo_endpoints_require_authentication(client):
    assert client.get("/api/v1/uploads/logo").status_code == 401
