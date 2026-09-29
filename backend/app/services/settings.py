"""
Ruchita Interiors — settings service (§15).

Business rules for the configurable company data. API blueprints stay thin
(§23): they parse, call one function here and respond.

Two invariants matter more than the code:

- **Settings changes never rewrite documents** (§8.4): everything here mutates
  only `company_settings` / `terms_conditions`. Snapshots are taken at document
  creation in later phases.
- **`is_default` is exclusive per scope** (§15): promoting one term demotes the
  previous default for the same scope, so "the default" is always a single row.
"""

from __future__ import annotations

from pathlib import Path

from flask import current_app
from sqlalchemy import select

from app.extensions.database import db
from app.models import CompanySettings, TermsConditions
from app.utils.errors import not_found, validation_error

# Only these keys are writable through PUT /settings/company. `logo_path` is
# deliberately absent: it changes exclusively through the upload/delete
# endpoints (§15 Branding), never by client-supplied JSON.
EDITABLE_FIELDS = (
    "company_name",
    "tagline",
    "phone",
    "email",
    "website",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "pincode",
    "gstin",
    "default_gst_bp",
    "default_validity_days",
    "quotation_prefix",
    "invoice_prefix",
    "bank_account_name",
    "bank_account_number",
    "bank_name",
    "bank_ifsc",
    "bank_branch",
    "upi_id",
    "signatory_name",
    "footer_text",
    "item_categories",
    "units",
)


def get_settings() -> CompanySettings:
    """The singleton row, created with defaults when absent (§15 seeding)."""
    return CompanySettings.get_row()


def save_settings(payload: dict) -> CompanySettings:
    """
    Apply the editable fields and return the saved row (normalized, §9.2).

    Unknown keys are ignored rather than rejected: the UI posts the union of all
    section forms, and a section that has not been opened yet simply contributes
    nothing new.
    """
    row = get_settings()

    for field in EDITABLE_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if isinstance(value, str):
            value = value.strip()
            # Empty string means "clear this field" for every text column.
            value = value or None
        setattr(row, field, value)

    # §8.1 primitives: GST in basis points (0–2800), validity in whole days.
    if row.default_gst_bp is not None and not 0 <= row.default_gst_bp <= 2800:
        raise validation_error("Default GST must be between 0% and 28%.", [{"field": "default_gst_bp", "message": "GST must be between 0 and 2800 basis points."}])
    if row.default_validity_days is not None and not 0 <= row.default_validity_days <= 365:
        raise validation_error("Validity must be between 0 and 365 days.", [{"field": "default_validity_days", "message": "Validity must be between 0 and 365 days."}])

    # A prefix becomes part of every future document number (§12), so it must be
    # short, uppercase-alphanumeric and never contain a separator.
    for field in ("quotation_prefix", "invoice_prefix"):
        prefix = getattr(row, field)
        if not prefix or not 1 <= len(prefix) <= 12 or not prefix.replace("-", "").isalnum():
            raise validation_error(
                "Prefixes must be 1–12 letters, digits or dashes.",
                [{"field": field, "message": "Use 1–12 letters, digits or dashes."}],
            )

    # IFSC is the one bank field with a fixed shape: 11 characters exactly,
    # whenever it is filled in at all.
    if row.bank_ifsc and len(row.bank_ifsc) != 11:
        raise validation_error(
            "IFSC must be exactly 11 characters.",
            [{"field": "bank_ifsc", "message": "IFSC must be exactly 11 characters."}],
        )

    for field in ("item_categories", "units"):
        value = getattr(row, field)
        if value is None:
            setattr(row, field, [])
            continue
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise validation_error(
                f"{field} must be a list of labels.",
                [{"field": field, "message": "Provide a list of labels."}],
            )
        cleaned = [item.strip() for item in value if item.strip()]
        # Cap length per §16's string caps; 50 entries is far beyond any real
        # catalogue but keeps a hostile payload from bloating the row.
        if len(cleaned) > 50 or any(len(item) > 100 for item in cleaned):
            raise validation_error(
                f"{field} is too long.",
                [{"field": field, "message": "Use at most 50 labels of 100 characters each."}],
            )
        setattr(row, field, cleaned)

    db.session.commit()
    return row


# --------------------------------------------------------------------- terms


def list_terms() -> list[TermsConditions]:
    return list(db.session.scalars(select(TermsConditions).order_by(TermsConditions.scope, TermsConditions.id)))


def create_term(payload: dict) -> TermsConditions:
    term = TermsConditions(
        scope=payload["scope"],
        title=payload["title"].strip(),
        body=payload["body"].strip(),
        is_default=bool(payload.get("is_default", False)),
    )
    _assert_terms_shape(term)
    db.session.add(term)
    _promote_default(term)
    db.session.commit()
    return term


def update_term(term_id: int, payload: dict) -> TermsConditions:
    term = db.session.get(TermsConditions, term_id)
    if term is None:
        raise not_found("That terms entry could not be found.")

    if "scope" in payload:
        term.scope = payload["scope"]
    if "title" in payload:
        term.title = payload["title"].strip()
    if "body" in payload:
        term.body = payload["body"].strip()
    if "is_default" in payload:
        term.is_default = bool(payload["is_default"])

    _assert_terms_shape(term)
    _promote_default(term)
    db.session.commit()
    return term


def delete_term(term_id: int) -> None:
    term = db.session.get(TermsConditions, term_id)
    if term is None:
        raise not_found("That terms entry could not be found.")
    db.session.delete(term)
    db.session.commit()


def _assert_terms_shape(term: TermsConditions) -> None:
    if term.scope not in ("quotation", "invoice", "both"):
        raise validation_error(
            "Scope must be quotation, invoice or both.",
            [{"field": "scope", "message": "Choose quotation, invoice or both."}],
        )
    if not term.title:
        raise validation_error("A title is required.", [{"field": "title", "message": "A title is required."}])
    if not term.body:
        raise validation_error("The body is required.", [{"field": "body", "message": "The body is required."}])
    if len(term.title) > 200:
        raise validation_error("The title is too long.", [{"field": "title", "message": "Keep the title under 200 characters."}])


def _promote_default(term: TermsConditions) -> None:
    """
    §15: "one default per scope" — taken literally, per scope *column*.

    Promoting a row clears `is_default` on the other rows of the same scope only.
    A `both`-scope default is a shared fallback: it is demoted only by another
    `both` row, and a document picks its default by exact-scope preference
    (exact scope first, `both` as fallback) — so a quotation-specific default
    never silently strips an invoice that relies on the shared one.
    """
    if not term.is_default:
        return
    others = db.session.scalars(
        select(TermsConditions).where(
            TermsConditions.id != term.id,
            TermsConditions.is_default.is_(True),
            TermsConditions.scope == term.scope,
        )
    )
    for other in others:
        other.is_default = False


# ------------------------------------------------------------- stored images


def _stored_image_absolute_path(relative_path: str | None) -> Path | None:
    """
    Resolve a stored relative path under `UPLOADS_DIR`, or None when unset or unsafe.

    A stored path is always relative to UPLOADS_DIR; resolving + checking the
    parent keeps a tampered column from reading any file on disk.
    """
    if not relative_path:
        return None
    uploads_root = Path(current_app.config["UPLOADS_DIR"])
    candidate = (uploads_root / relative_path).resolve()
    if uploads_root.resolve() not in candidate.parents:
        return None
    return candidate


def _set_image_path(column: str, relative_path: str | None) -> CompanySettings:
    setattr(get_settings(), column, relative_path)
    db.session.commit()
    return get_settings()


def logo_absolute_path() -> Path | None:
    """Where the stored logo lives on disk, or None when none was uploaded."""
    return _stored_image_absolute_path(get_settings().logo_path)


def payment_qr_absolute_path() -> Path | None:
    """Where the stored payment QR lives on disk, or None when none was uploaded."""
    return _stored_image_absolute_path(get_settings().payment_qr_path)


def set_logo_path(relative_path: str) -> CompanySettings:
    return _set_image_path("logo_path", relative_path)


def clear_logo() -> CompanySettings:
    return _set_image_path("logo_path", None)


def set_payment_qr_path(relative_path: str) -> CompanySettings:
    return _set_image_path("payment_qr_path", relative_path)


def clear_payment_qr() -> CompanySettings:
    return _set_image_path("payment_qr_path", None)
