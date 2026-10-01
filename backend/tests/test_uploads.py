"""
Phase 3 logo upload tests.

Mapped to PLAN §25 Phase 3: a small PNG uploads; SVG and an oversized file are
rejected with clear per-field errors; the stored file is served back; delete
removes both the file and the reference.
"""

from __future__ import annotations

import io

import pytest
from flask import current_app
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


def _png_of_at_least(min_bytes: int, max_bytes: int) -> bytes:
    """A real, decodable PNG whose size lands inside `[min_bytes, max_bytes)`.

    Noise does not compress, so the file size tracks the pixel count closely
    enough to hit a target band. Keeping the test honest matters: the file has to
    be a genuine PNG, not a blob with PNG magic bytes, or it would be refused by
    the decode check instead of the size check under test.
    """
    import random

    random.seed(7)
    for side in range(400, 2400, 20):
        image = Image.new("RGB", (side, side))
        image.putdata(
            [
                (random.randrange(256), random.randrange(256), random.randrange(256))
                for _ in range(side * side)
            ]
        )
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=False)
        blob = buffer.getvalue()
        if min_bytes <= len(blob) < max_bytes:
            return blob
    raise AssertionError(f"could not build a PNG in [{min_bytes}, {max_bytes})")


def test_oversize_upload_is_rejected(authed_client):
    """A valid PNG above the 2 MB cap must be rejected with a clear message.

    This is the handler's own limit, so the file is sized to clear 2 MB while
    staying under `MAX_CONTENT_LENGTH` — otherwise Werkzeug rejects it at the
    transport layer (see `test_body_over_max_content_length_is_refused_by_the
   _framework`) and the size check under test never runs.
    """
    app = current_app
    cap = app.config["IMAGE_UPLOAD_MAX_SIZE_BYTES"]
    body_cap = app.config["MAX_CONTENT_LENGTH"]
    # Leave room for the multipart framing so the request as a whole fits.
    big = _png_of_at_least(cap + 1024, body_cap - 64 * 1024)

    response = _upload(authed_client, big, "big.png", "image/png")
    assert response.status_code == 422
    error = response.get_json()["error"]
    assert "MB" in error["message"]
    assert error["details"][0]["field"] == "logo"


def test_body_over_max_content_length_is_refused_by_the_framework(authed_client):
    """
    A body past `MAX_CONTENT_LENGTH` never reaches the handler.

    This is the bound that actually prevents a memory-exhaustion upload. The
    handler's own 2 MB image check runs *after* the body has been buffered, so on
    its own it is a politeness rule rather than a resource limit; `MAX_CONTENT_LENGTH`
    is enforced by Werkzeug before any handler code executes, which is why the
    status is 413 rather than the 422 the in-handler check returns.
    """
    cap = current_app.config["MAX_CONTENT_LENGTH"]
    response = _upload(authed_client, b"\x89PNG\r\n\x1a\n" + b"0" * (cap + 1024), "big.png", "image/png")
    assert response.status_code == 413


def test_a_lying_content_length_cannot_force_a_large_read(authed_client):
    """
    A `Content-Length` under the cap does not make an oversize body acceptable.

    The declared length is only an early exit. If a client declares a small
    length and sends more, the bounded read is what stops it — without that, the
    early exit would be a bypass of the size limit rather than an optimisation.
    """
    cap = current_app.config["IMAGE_UPLOAD_MAX_SIZE_BYTES"]
    blob = b"\x89PNG\r\n\x1a\n" + b"0" * (cap + 4096)

    response = authed_client.post(
        "/api/v1/settings/logo",
        data={"logo": (io.BytesIO(blob), "sneaky.png")},
        content_type="multipart/form-data",
        headers={**_csrf(authed_client), "Content-Length": "1024"},
    )
    # Werkzeug may reject it at the transport layer or the handler may; either is
    # a refusal. What must not happen is a 200.
    assert response.status_code in (413, 422)
    assert "logo_path" not in response.get_json().get("data", {})


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


def test_logo_upload_requires_a_csrf_token(authed_client):
    """The logo routes are `@csrf_protect` too (§16: every non-GET mutation)."""
    response = authed_client.post(
        "/api/v1/settings/logo",
        data={"logo": (io.BytesIO(_png_bytes()), "logo.png", "image/png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 403
    assert CompanySettings.get_row().logo_path is None


def test_logo_delete_requires_a_csrf_token(authed_client):
    """A forged DELETE must not be able to strip the branding off a signed-in owner."""
    uploaded = _upload(authed_client, _png_bytes(), "logo.png", "image/png")
    logo_path = uploaded.get_json()["data"]["logo_path"]

    forged = authed_client.delete("/api/v1/settings/logo")
    assert forged.status_code == 403

    # The file and the reference both survive the refused request.
    assert CompanySettings.get_row().logo_path == logo_path
    from pathlib import Path

    from flask import current_app

    with authed_client.application.app_context():
        assert (Path(current_app.config["UPLOADS_DIR"]) / logo_path).exists()


def test_logo_endpoints_require_authentication(client):
    assert client.get("/api/v1/uploads/logo").status_code == 401


# ------------------------------------------------------------- Phase 8 QR


def _upload_qr(client, data: bytes, filename: str, mimetype: str):
    header = _csrf(client)
    return client.post(
        "/api/v1/settings/payment-qr",
        data={"payment_qr": (io.BytesIO(data), filename, mimetype)},
        content_type="multipart/form-data",
        headers=header,
    )


def test_payment_qr_upload_succeeds_and_is_served(authed_client):
    response = _upload_qr(authed_client, _png_bytes(), "qr.png", "image/png")
    assert response.status_code == 200, response.get_data(as_text=True)
    qr_path = response.get_json()["data"]["payment_qr_path"]
    assert qr_path.endswith(".png")
    # Its own subdirectory, so clearing a logo can never unlink the QR (§8.5).
    assert qr_path.startswith("payment-qr/")

    served = authed_client.get("/api/v1/uploads/payment-qr")
    assert served.status_code == 200
    assert served.headers["Content-Type"].startswith("image/png")
    assert bytes(served.data).startswith(b"\x89PNG")


def test_payment_qr_is_reported_in_settings(authed_client):
    """The invoice render reads the QR through the settings payload (§8.5)."""
    _upload_qr(authed_client, _png_bytes(), "qr.png", "image/png")
    payload = authed_client.get("/api/v1/settings/company").get_json()["data"]["settings"]
    assert payload["payment_qr_path"].endswith(".png")


def test_payment_qr_rejects_svg(authed_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    response = _upload_qr(authed_client, svg, "qr.svg", "image/svg+xml")

    assert response.status_code == 422
    error = response.get_json()["error"]
    assert "SVG" in error["message"] or "PNG" in error["message"]
    # The error field is the QR slot, not the logo's.
    assert error["details"][0]["field"] == "payment_qr"


def test_payment_qr_rejects_a_forged_png(authed_client):
    assert _upload_qr(authed_client, b"not an image", "qr.png", "image/png").status_code == 422


def test_payment_qr_replace_removes_the_previous_file(authed_client):
    first = _upload_qr(authed_client, _png_bytes(), "qr.png", "image/png")
    first_path = first.get_json()["data"]["payment_qr_path"]

    second = _upload_qr(authed_client, _png_bytes(color=(10, 20, 30)), "qr2.png", "image/png")
    second_path = second.get_json()["data"]["payment_qr_path"]
    assert second_path != first_path

    from pathlib import Path

    from flask import current_app

    with authed_client.application.app_context():
        root = Path(current_app.config["UPLOADS_DIR"])
        assert not (root / first_path).exists()
        assert (root / second_path).exists()


def test_payment_qr_delete_removes_file_and_reference(authed_client):
    uploaded = _upload_qr(authed_client, _png_bytes(), "qr.png", "image/png")
    qr_path = uploaded.get_json()["data"]["payment_qr_path"]

    deleted = authed_client.delete("/api/v1/settings/payment-qr", headers=_csrf(authed_client))
    assert deleted.status_code == 200

    from pathlib import Path

    from flask import current_app

    with authed_client.application.app_context():
        assert CompanySettings.get_row().payment_qr_path is None
        assert not (Path(current_app.config["UPLOADS_DIR"]) / qr_path).exists()

    assert authed_client.get("/api/v1/uploads/payment-qr").status_code == 404


def test_serving_without_payment_qr_is_404(authed_client):
    assert authed_client.get("/api/v1/uploads/payment-qr").status_code == 404


def test_payment_qr_endpoints_require_authentication(client):
    assert client.get("/api/v1/uploads/payment-qr").status_code == 401
    assert client.post(
        "/api/v1/settings/payment-qr",
        data={"payment_qr": (io.BytesIO(_png_bytes()), "qr.png", "image/png")},
        content_type="multipart/form-data",
    ).status_code == 401
    assert client.delete("/api/v1/settings/payment-qr").status_code == 401


def test_payment_qr_upload_requires_a_csrf_token(authed_client):
    """Phase 8's mutating QR routes are `@csrf_protect` (§16)."""
    response = authed_client.post(
        "/api/v1/settings/payment-qr",
        data={"payment_qr": (io.BytesIO(_png_bytes()), "qr.png", "image/png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 403


def test_payment_qr_is_not_writable_through_put_settings(authed_client):
    """`payment_qr_path` changes only via the upload/delete routes, never by JSON."""
    response = authed_client.put(
        "/api/v1/settings/company",
        json={"payment_qr_path": "payment-qr/forged.png"},
        headers=_csrf(authed_client),
    )
    assert response.status_code == 200
    assert CompanySettings.get_row().payment_qr_path is None


def test_logo_and_qr_are_independent_slots(authed_client):
    """Uploading a QR must not disturb an existing logo, and vice versa."""
    logo = authed_client.post(
        "/api/v1/settings/logo",
        data={"logo": (io.BytesIO(_png_bytes()), "logo.png", "image/png")},
        content_type="multipart/form-data",
        headers=_csrf(authed_client),
    )
    logo_path = logo.get_json()["data"]["logo_path"]

    _upload_qr(authed_client, _png_bytes(), "qr.png", "image/png")

    from pathlib import Path

    from flask import current_app

    row = CompanySettings.get_row()
    assert row.logo_path == logo_path
    assert row.payment_qr_path is not None
    with authed_client.application.app_context():
        assert (Path(current_app.config["UPLOADS_DIR"]) / logo_path).exists()

    authed_client.delete("/api/v1/settings/payment-qr", headers=_csrf(authed_client))
    assert CompanySettings.get_row().logo_path == logo_path
