"""
Ruchita Interiors — logo upload & serving endpoints (§9.2, §15, §16).

    POST   /api/v1/settings/logo  (multipart) -> validate + store + remember
    GET    /api/v1/uploads/logo              -> the stored file (long cache)
    DELETE /api/v1/settings/logo             -> remove it

Upload policy (§15/§16): PNG/JPEG/WEBP only, ≤ 2 MB, checked by extension +
MIME + magic bytes, stored under a UUID name in `uploads/branding/` outside the
static folder. **SVG is rejected on purpose**: an SVG can carry script, and it
would be rendered same-origin in the app shell and on every printed document.

`GET /uploads/logo` is authenticated like every other endpoint (§16 "served via
authenticated API route") but allows long browser caching, because a logo file's
name changes whenever its content does.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from flask import Blueprint, current_app, send_file
from PIL import Image, UnidentifiedImageError

from app.models import CompanySettings
from app.services.settings import clear_logo, set_logo_path
from app.utils.errors import not_found, success, validation_error
from app.utils.guards import login_required

uploads_bp = Blueprint("uploads", __name__)

# Extension -> (expected leading magic bytes, allowed MIME types).
# Used for the content sniff, because a client-declared Content-Type is trivial
# to lie about (§16: extension + MIME + magic-byte check).
_MAGIC = {
    "png": (b"\x89PNG\r\n\x1a\n", {"image/png"}),
    "jpg": (b"\xff\xd8\xff", {"image/jpeg", "image/jpg", "image/pjpeg"}),
    "jpeg": (b"\xff\xd8\xff", {"image/jpeg", "image/jpg", "image/pjpeg"}),
    "webp": (b"RIFF", {"image/webp"}),
}

_DOWNLOAD_NAMES = {"png": "logo.png", "jpg": "logo.jpg", "jpeg": "logo.jpg", "webp": "logo.webp"}


@uploads_bp.post("/settings/logo")
@login_required
def upload_logo():
    file = _uploaded_file()
    extension = _validate(file)

    branding_dir = Path(current_app.config["UPLOADS_DIR"]) / current_app.config.get("LOGO_SUBDIR", "branding")
    branding_dir.mkdir(parents=True, exist_ok=True)

    # A UUID name: the client never controls the path, and re-uploads do not
    # collide. The old file is removed after the new one is committed.
    stored_name = f"{uuid.uuid4().hex}.{extension}"
    target = branding_dir / stored_name

    previous = CompanySettings.get_row().logo_path
    previous_file = None
    if previous:
        candidate = (branding_dir / Path(previous).name).resolve()
        if branding_dir.resolve() in candidate.parents:
            previous_file = candidate

    file.save(target)
    try:
        set_logo_path(f"{current_app.config.get('LOGO_SUBDIR', 'branding')}/{stored_name}")
    except Exception:
        # The row write failed; do not leave an orphan file behind.
        target.unlink(missing_ok=True)
        raise
    if previous_file and previous_file.is_file():
        previous_file.unlink(missing_ok=True)

    return success({"logo_path": f"{current_app.config.get('LOGO_SUBDIR', 'branding')}/{stored_name}"})


@uploads_bp.get("/uploads/logo")
@login_required
def serve_logo():
    path = _stored_logo_path()
    if path is None:
        raise not_found("No logo has been uploaded yet.")

    extension = path.suffix.lower().lstrip(".")
    if extension not in _MAGIC:
        raise not_found("The stored logo has an unsupported format.")
    mimetype = next(iter(_MAGIC[extension][1]))
    response = send_file(path, mimetype=mimetype, conditional=True)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@uploads_bp.delete("/settings/logo")
@login_required
def delete_logo():
    path = _stored_logo_path()
    if path is not None and path.is_file():
        path.unlink(missing_ok=True)
    clear_logo()
    return success({"deleted": True})


# --------------------------------------------------------------------- helpers


def _uploaded_file():
    from flask import request

    file = request.files.get("logo")
    if file is None or not file.filename:
        raise validation_error(
            "Choose a logo file to upload.",
            [{"field": "logo", "message": "A file is required."}],
        )
    return file


def _validate(file) -> str:
    """
    Full §16 gauntlet; returns the normalized extension on success.

    Each failure says *why* in the details, which is what §25 asks the Settings
    UI to show inline under the upload control.
    """
    filename = file.filename or ""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in current_app.config["LOGO_ALLOWED_EXTENSIONS"]:
        raise validation_error(
            "The logo must be a PNG, JPEG or WEBP image. SVG files are not accepted for security reasons.",
            [{"field": "logo", "message": "Use a PNG, JPEG or WEBP file."}],
        )

    declared = (file.mimetype or "").lower()
    if declared and declared not in current_app.config["LOGO_ALLOWED_MIME_TYPES"]:
        raise validation_error(
            "That file is not an accepted image type.",
            [{"field": "logo", "message": "The file type is not an accepted image."}],
        )

    blob = file.read()
    file.seek(0)
    if len(blob) == 0:
        raise validation_error("The file is empty.", [{"field": "logo", "message": "The file is empty."}])
    if len(blob) > current_app.config["LOGO_MAX_SIZE_BYTES"]:
        limit_mb = current_app.config["LOGO_MAX_SIZE_BYTES"] // (1024 * 1024)
        raise validation_error(
            f"The logo must be {limit_mb} MB or smaller.",
            [{"field": "logo", "message": f"Keep the file under {limit_mb} MB."}],
        )

    magic, _allowed_mimes = _MAGIC[extension]
    if not blob.startswith(magic):
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": "logo", "message": "That file is not a valid image."}],
        )

    # WEBP is a RIFF container; the magic check above only proves "RIFF". Look
    # for the WEBP fourcc at the standard offset before accepting it.
    if extension == "webp" and blob[8:12] != b"WEBP":
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": "logo", "message": "That file is not a valid image."}],
        )

    # Final decode check: Pillow opens and verifies the image, which rejects
    # polyglots whose bytes prefix-match a real format but are not decodable.
    try:
        probe = Image.open(file)
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": "logo", "message": "That file is not a valid image."}],
        )
    finally:
        file.seek(0)

    return extension


def _stored_logo_path():
    from app.services.settings import logo_absolute_path

    try:
        return logo_absolute_path()
    except Exception:
        return None
