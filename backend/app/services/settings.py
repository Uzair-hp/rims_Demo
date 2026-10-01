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
from sqlalchemy.exc import SQLAlchemyError

from app.extensions.database import db
from app.models import CompanySettings, TermsConditions
from app.utils.errors import ApiError, not_found, validation_error

#: Longest accepted UPI ID, matching the column width (§8.5).
MAX_UPI_ID_LENGTH = 100


def validate_upi_id(value: str) -> str | None:
    """
    Shape-check a UPI ID. Returns a message when invalid, else None.

    Permissive by design. A UPI ID is `handle@provider`, and the provider suffix is
    *not* a closed set: `okaxis`, `paytm`, `ybl`, `oksbi` and a bank's own handle are
    all real, and a new one can appear without notice. An allow-list would reject a
    legitimate account and block a real payment, which is far worse than accepting a
    well-formed-but-nonexistent handle - and an account that does not exist fails
    loudly in the payer's app, where a customer can see it.

    So the checks are the ones that catch actual typos:

    - must contain an "@", splitting handle from provider,
    - must have something on both sides of it,
    - no whitespace anywhere (a VPA cannot contain it, and a space is almost always a
      paste artefact),
    - within the column's length.

    Applied on write only. A value stored before this rule existed is left alone and
    is never re-validated on read, so a stricter rule can never make an existing
    install fail to start.
    """
    if not isinstance(value, str):
        return "The UPI ID must be text."
    candidate = value.strip()
    if not candidate:
        return "Enter a UPI ID, or leave it empty to turn the QR off."
    if len(candidate) > MAX_UPI_ID_LENGTH:
        return f"The UPI ID must be at most {MAX_UPI_ID_LENGTH} characters."
    if any(character.isspace() for character in candidate):
        return "The UPI ID cannot contain spaces."
    if "@" not in candidate:
        return "The UPI ID must contain an @, e.g. business@okaxis."
    handle, _, provider = candidate.partition("@")
    if not handle or not provider:
        return "The UPI ID needs text on both sides of the @, e.g. business@okaxis."
    return None

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

    Two rules make this safe to fail:

    - **Validate a plain dict before touching the row.** Every check below used to
      read back off the ORM object, which meant the row was mutated by `setattr`
      and only then rejected. A raised `ApiError` is *handled*, so the
      `teardown_request` rollback does not fire for it — the dirty state survived
      on the session and was flushed by the next request's context teardown,
      committing a rejected change. Validating the merged values first means a
      rejection cannot have written anything.

    - **Roll back on any failure, including a database one.** A commit that raises
      leaves the session unusable; without an explicit rollback the next request on
      the same scoped session inherits it.
    """
    row = get_settings()

    # The prospective state: the payload layered over the current row, with the
    # same normalization applied. Validation reads this, never `row`.
    candidate = _normalized_candidate(row, payload)
    _validate_candidate(candidate, row)

    try:
        for field, value in candidate.items():
            setattr(row, field, value)
        db.session.commit()
    except ApiError:
        db.session.rollback()
        raise
    except SQLAlchemyError:
        db.session.rollback()
        raise
    return row


def _normalized_candidate(row: CompanySettings, payload: dict) -> dict:
    """
    The values a save *would* produce, as a plain dict.

    Includes only the fields the payload actually carries, so a partial save
    leaves everything else alone, and applies the same string normalization
    `setattr` would have: trimmed, with an empty string meaning "clear".
    """
    candidate: dict = {}
    for field in EDITABLE_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if isinstance(value, str):
            value = value.strip()
            # Empty string means "clear this field" for every text column.
            value = value or None
        candidate[field] = value
    return candidate


def _validate_candidate(candidate: dict, row: CompanySettings) -> None:
    """
    Every §15/§16 rule for the settings row, checked against proposed values.

    A pure function of `candidate` and the untouched row, so it runs before
    anything is written. A field the payload did not carry resolves to the row's
    *current* value, which is what makes a partial save validate the row that would
    result rather than only the submitted fragment — a save carrying just
    `bank_ifsc` must not be judged on an absent `quotation_prefix`.

    `candidate` is mutated in place for the two list fields, whose cleaned form is
    what should be stored.
    """

    def value_of(field: str):
        """The value this save would leave in `field`."""
        if field in candidate:
            return candidate[field]
        return getattr(row, field)

    # §8.1 primitives: GST in basis points (0–2800), validity in whole days.
    gst_bp = value_of("default_gst_bp")
    if gst_bp is not None and not 0 <= gst_bp <= 2800:
        raise validation_error(
            "Default GST must be between 0% and 28%.",
            [{"field": "default_gst_bp", "message": "GST must be between 0 and 2800 basis points."}],
        )
    validity_days = value_of("default_validity_days")
    if validity_days is not None and not 0 <= validity_days <= 365:
        raise validation_error(
            "Validity must be between 0 and 365 days.",
            [{"field": "default_validity_days", "message": "Validity must be between 0 and 365 days."}],
        )

    # A prefix becomes part of every future document number (§12), so it must be
    # short, uppercase-alphanumeric and never contain a separator.
    for field in ("quotation_prefix", "invoice_prefix"):
        prefix = value_of(field)
        if not prefix or not 1 <= len(prefix) <= 12 or not prefix.replace("-", "").isalnum():
            raise validation_error(
                "Prefixes must be 1–12 letters, digits or dashes.",
                [{"field": field, "message": "Use 1–12 letters, digits or dashes."}],
            )

    # IFSC is the one bank field with a fixed shape: 11 characters exactly,
    # whenever it is filled in at all.
    ifsc = value_of("bank_ifsc")
    if ifsc and len(ifsc) != 11:
        raise validation_error(
            "IFSC must be exactly 11 characters.",
            [{"field": "bank_ifsc", "message": "IFSC must be exactly 11 characters."}],
        )

    # The UPI ID becomes the `pa` parameter of every payment QR (§8.5), so a typo
    # here silently misdirects customer money rather than failing visibly.
    #
    # Validated only for *shape*: no spaces, and an "@" separating the handle from a
    # provider suffix. Deliberately not a provider allow-list — a VPA's suffix is not
    # an enumerable set, and rejecting a legitimate one (`name@okaxis`, `name@paytm`,
    # a bank's own handle) would block a real payment to fix a cosmetic problem.
    upi_id = value_of("upi_id")
    if upi_id:
        problem = validate_upi_id(upi_id)
        if problem:
            raise validation_error(
                problem, [{"field": "upi_id", "message": "Check the UPI ID format."}]
            )

    for field in ("item_categories", "units"):
        # Only normalize what this save actually carries; the rest is already in
        # the row's stored, cleaned form.
        if field not in candidate:
            continue
        value = candidate[field]
        if value is None:
            candidate[field] = []
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
        candidate[field] = cleaned


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
