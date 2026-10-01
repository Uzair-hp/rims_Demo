"""
Ruchita Interiors — image upload & serving endpoints (§9.2, §15, §16).

    POST   /api/v1/settings/logo        (multipart) -> validate + store + remember
    GET    /api/v1/uploads/logo                 -> the stored file (long cache)
    DELETE /api/v1/settings/logo                -> remove it
    POST   /api/v1/settings/payment-qr   (multipart) -> validate + store + remember
    GET    /api/v1/uploads/payment-qr            -> the stored file (long cache)
    DELETE /api/v1/settings/payment-qr           -> remove it

Upload policy (§15/§16): PNG/JPEG/WEBP only, ≤ 2 MB, checked by extension +
MIME + magic bytes, stored under a UUID name outside the static folder.
**SVG is rejected on purpose**: an SVG can carry script, and it would be rendered
same-origin in the app shell and on every printed document.

The logo (§15) and the payment QR (§8.5) are the same kind of asset — a small
owner-supplied raster image behind an authenticated route — so they share one
policy and one validation gauntlet rather than two copies free to drift.

`GET /uploads/...` is authenticated like every other endpoint (§16 "served via
authenticated API route") but allows long browser caching, because a stored
file's name changes whenever its content does.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from flask import Blueprint, current_app, request, send_file
from PIL import Image, UnidentifiedImageError

from app.models import CompanySettings
from app.services.csrf import csrf_protect
from app.services.settings import (
    clear_logo,
    clear_payment_qr,
    logo_absolute_path,
    payment_qr_absolute_path,
    set_logo_path,
    set_payment_qr_path,
)
from app.utils.errors import not_found, success, validation_error
from app.utils.guards import login_required, owner_required

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

# The logo and the payment QR are owner-only, like the settings row they live in:
# the QR is a live payment instruction read on every invoice render, so replacing
# it redirects where customers send money. Reading one only needs a session —
# every document needs to render it — but changing one needs the owner.
#
# `@owner_required` sits under `@login_required` so an anonymous request still
# gets 401 rather than a 403 that would confirm the route exists.


@uploads_bp.post("/settings/logo")
@login_required
@owner_required
@csrf_protect
def upload_logo():
    return _store_image("logo")


@uploads_bp.get("/uploads/logo")
@login_required
def serve_logo():
    return _serve_image("logo")


@uploads_bp.delete("/settings/logo")
@login_required
@owner_required
@csrf_protect
def delete_logo():
    return _remove_image("logo", clear_logo, logo_absolute_path)


# ---------------------------------------------------------------- payment QR
#
# The QR is a *live* payment instruction, read from CompanySettings on every
# invoice render — it is never copied into `Invoice.bank_snapshot`. Snapshotting
# it would mean a re-issued or re-sent document could still show a QR for an
# account that has been closed or changed.


@uploads_bp.post("/settings/payment-qr")
@login_required
@owner_required
@csrf_protect
def upload_payment_qr():
    return _store_image("payment_qr")


@uploads_bp.get("/uploads/payment-qr")
@login_required
def serve_payment_qr():
    return _serve_image("payment_qr")


@uploads_bp.delete("/settings/payment-qr")
@login_required
@owner_required
@csrf_protect
def delete_payment_qr():
    return _remove_image("payment_qr", clear_payment_qr, payment_qr_absolute_path)


# --------------------------------------------------------------------- helpers


def _uploaded_file(field: str, label: str):
    file = request.files.get(field)
    if file is None or not file.filename:
        raise validation_error(
            f"Choose a {label} file to upload.",
            [{"field": field, "message": "A file is required."}],
        )
    return file


def _declared_content_length() -> int | None:
    """
    The request's `Content-Length`, or `None` when it is absent or unparseable.

    `None` is not treated as zero and does not fail the request: chunked
    multipart bodies legitimately arrive without one. The bounded read in
    `_validate` is what actually enforces the limit in that case, and this is
    only the cheap early exit.
    """
    raw = request.content_length
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _validate(file, *, field: str, label: str) -> str:
    """
    Full §16 gauntlet; returns the normalized extension on success.

    Each failure says *why* in the details, which is what §25 asks the Settings
    UI to show inline under the upload control.
    """
    filename = file.filename or ""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in current_app.config["IMAGE_UPLOAD_ALLOWED_EXTENSIONS"]:
        raise validation_error(
            f"The {label} must be a PNG, JPEG or WEBP image. SVG files are not accepted for security reasons.",
            [{"field": field, "message": "Use a PNG, JPEG or WEBP file."}],
        )

    declared = (file.mimetype or "").lower()
    # `image/jpg` and `image/pjpeg` are the two common non-standard spellings of
    # JPEG that browsers and scanners emit; they are covered by the magic check.
    accepted_mimes = current_app.config["IMAGE_UPLOAD_ALLOWED_MIME_TYPES"] | {"image/jpg", "image/pjpeg"}
    if declared and declared not in accepted_mimes:
        raise validation_error(
            "That file is not an accepted image type.",
            [{"field": field, "message": "The file type is not an accepted image."}],
        )

    # Size is checked BEFORE the body is read, and read in bounded slices.
    #
    # `file.read()` with no argument pulls the whole upload into memory, so a
    # 2 MB policy checked afterwards is not a 2 MB policy: the process has
    # already allocated whatever the client sent. `MAX_CONTENT_LENGTH` (set in
    # config) is the outer bound, enforced by Werkzeug before the handler runs;
    # the declared `Content-Length` is the cheap in-handler check; and the read
    # itself stops one byte past the limit so an undeclared or lying
    # `Content-Length` still cannot force a large allocation.
    max_bytes = current_app.config["IMAGE_UPLOAD_MAX_SIZE_BYTES"]
    limit_mb = max_bytes // (1024 * 1024)

    oversize = [
        {"field": field, "message": f"Keep the file under {limit_mb} MB."}
    ]

    declared_length = _declared_content_length()
    if declared_length is not None and declared_length > max_bytes:
        raise validation_error(f"The {label} must be {limit_mb} MB or smaller.", oversize)

    blob = file.read(max_bytes + 1)
    file.seek(0)
    if len(blob) > max_bytes:
        raise validation_error(f"The {label} must be {limit_mb} MB or smaller.", oversize)
    if len(blob) == 0:
        raise validation_error("The file is empty.", [{"field": field, "message": "The file is empty."}])

    # `.get`, not `[...]`: the extension is validated against
    # `IMAGE_UPLOAD_ALLOWED_EXTENSIONS` above, and if that config and this table
    # ever drift apart a bare lookup would raise `KeyError` and surface as a 500
    # on a user-supplied filename.
    magic_entry = _MAGIC.get(extension)
    if magic_entry is None:
        raise validation_error(
            "That file is not an accepted image type.",
            [{"field": field, "message": "Use a PNG, JPEG or WEBP file."}],
        )
    magic, _allowed_mimes = magic_entry
    if not blob.startswith(magic):
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": field, "message": "That file is not a valid image."}],
        )

    # WEBP is a RIFF container; the magic check above only proves "RIFF". Look
    # for the WEBP fourcc at the standard offset before accepting it.
    if extension == "webp" and blob[8:12] != b"WEBP":
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": field, "message": "That file is not a valid image."}],
        )

    # Final decode check: Pillow opens and verifies the image, which rejects
    # polyglots whose bytes prefix-match a real format but are not decodable.
    try:
        probe = Image.open(file)
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise validation_error(
            "The file's contents do not match its extension.",
            [{"field": field, "message": "That file is not a valid image."}],
        )
    finally:
        file.seek(0)

    return extension


def _store_image(slot: str):
    """
    Validate, save and remember one image slot; returns `{f"{slot}_path": ...}`.

    `slot` is "logo" or "payment_qr". The write order is deliberate: the file is
    saved first, the row is committed second, and a failed commit unlinks the
    new file so a rejected upload never leaves an orphan on disk. The previous
    file is only unlinked *after* the new row is committed, so a failure at any
    point leaves the slot pointing at a file that still exists.
    """
    subdir_key = f"{slot.upper()}_SUBDIR"
    subdir = current_app.config.get(subdir_key, "branding")
    label = "payment QR" if slot == "payment_qr" else "logo"

    file = _uploaded_file(slot, label)
    extension = _validate(file, field=slot, label=label)

    target_dir = Path(current_app.config["UPLOADS_DIR"]) / subdir
    target_dir.mkdir(parents=True, exist_ok=True)

    # A UUID name: the client never controls the path, and re-uploads do not
    # collide.
    stored_name = f"{uuid.uuid4().hex}.{extension}"
    target = target_dir / stored_name
    relative_path = f"{subdir}/{stored_name}"

    previous = getattr(CompanySettings.get_row(), f"{slot}_path")
    previous_file = None
    if previous:
        candidate = (target_dir / Path(previous).name).resolve()
        if target_dir.resolve() in candidate.parents:
            previous_file = candidate

    setter = set_payment_qr_path if slot == "payment_qr" else set_logo_path
    file.save(target)
    try:
        setter(relative_path)
    except Exception:
        # The row write failed; do not leave an orphan file behind.
        target.unlink(missing_ok=True)
        raise
    if previous_file and previous_file.is_file():
        previous_file.unlink(missing_ok=True)

    return success({f"{slot}_path": relative_path})


def _serve_image(slot: str):
    """Serve the current file for a slot with a long immutable cache."""
    resolver = payment_qr_absolute_path if slot == "payment_qr" else logo_absolute_path
    label = "payment QR" if slot == "payment_qr" else "logo"
    path = resolver()
    if path is None:
        raise not_found(f"No {label} has been uploaded yet.")

    extension = path.suffix.lower().lstrip(".")
    entry = _MAGIC.get(extension)
    if entry is None:
        raise not_found(f"The stored {label} has an unsupported format.")
    # The first MIME in the set, sorted rather than taken from set iteration
    # order: `.jpg` and `.jpeg` both map to a three-element set, and set order
    # varies per process, so the served `Content-Type` — and therefore the
    # browser's handling of it — was not stable across restarts.
    mimetype = sorted(entry[1])[0]
    response = send_file(path, mimetype=mimetype, conditional=True)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def _remove_image(slot: str, clearer, resolver):
    path = resolver()
    if path is not None and path.is_file():
        path.unlink(missing_ok=True)
    clearer()
    return success({"deleted": True})
