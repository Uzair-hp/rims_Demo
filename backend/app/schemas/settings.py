"""
Ruchita Interiors — settings request schemas (§15).

Marshmallow 4 syntax. Each §15 section maps to one schema; `PUT /settings/company`
accepts the union of the editable company fields and validates every one, so a
bad value in any section is a per-field 422 rather than a silent save.
"""

from __future__ import annotations

from marshmallow import EXCLUDE, Schema, ValidationError, fields, validate, validates_schema

from app.models.company_settings import DEFAULT_VALIDITY_DAYS, DEFAULT_GST_BP

MAX_TEXT = 200
MAX_ADDRESS = 500
MAX_FOOTER = 500

# §8.3: GST is stored in basis points, 0–2800 (0–28%).
MAX_GST_BP = 2800


class CompanySettingsSchema(Schema):
    """All editable `company_settings` fields. Fields absent from the payload are left untouched."""

    # The UI posts the union of every section form, and sections that have not
    # been opened contribute nothing. Unknown keys (e.g. a tampered `logo_path`)
    # are dropped here rather than 422-ing an otherwise valid save; the service
    # is the authority on what is editable.
    class Meta:
        unknown = EXCLUDE

    # No `load_default` anywhere: a field the client omitted must stay absent
    # from the loaded dict, otherwise a section that was never opened would
    # silently wipe its own values (or reset GST to the default) on every save.
    company_name = fields.String(validate=validate.Length(min=1, max=MAX_TEXT))
    # Nullable columns accept `null` as "clear this field", matching the
    # empty-string behaviour the UI sends. NOT NULL columns (company_name,
    # prefixes, the integer defaults) deliberately do not.
    tagline = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    phone = fields.String(allow_none=True, validate=validate.Length(max=32))
    email = fields.Email(allow_none=True)
    website = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    address_line1 = fields.String(allow_none=True, validate=validate.Length(max=MAX_ADDRESS))
    address_line2 = fields.String(allow_none=True, validate=validate.Length(max=MAX_ADDRESS))
    city = fields.String(allow_none=True, validate=validate.Length(max=100))
    state = fields.String(allow_none=True, validate=validate.Length(max=100))
    pincode = fields.String(allow_none=True, validate=validate.Length(max=12))
    gstin = fields.String(allow_none=True, validate=validate.Length(max=15))

    default_gst_bp = fields.Integer(validate=validate.Range(min=0, max=MAX_GST_BP))
    default_validity_days = fields.Integer(validate=validate.Range(min=0, max=365))
    quotation_prefix = fields.String(validate=validate.Length(min=1, max=12))
    invoice_prefix = fields.String(validate=validate.Length(min=1, max=12))

    bank_account_name = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    bank_account_number = fields.String(allow_none=True, validate=validate.Length(max=64))
    bank_name = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    bank_ifsc = fields.String(allow_none=True, validate=validate.Length(max=11))
    bank_branch = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    upi_id = fields.String(allow_none=True, validate=validate.Length(max=100))

    signatory_name = fields.String(allow_none=True, validate=validate.Length(max=MAX_TEXT))
    footer_text = fields.String(allow_none=True, validate=validate.Length(max=MAX_FOOTER))

    item_categories = fields.List(
        fields.String(validate=validate.Length(max=100)), allow_none=True
    )
    units = fields.List(fields.String(validate=validate.Length(max=100)), allow_none=True)

    @validates_schema
    def _prefix_shape(self, data, **kwargs):
        for field in ("quotation_prefix", "invoice_prefix"):
            prefix = data.get(field)
            if prefix is None:
                continue
            cleaned = prefix.strip()
            if not cleaned or len(cleaned) > 12 or not cleaned.replace("-", "").isalnum():
                raise ValidationError(
                    "Use 1–12 letters, digits or dashes.", field_name=field
                )
            data[field] = cleaned

    @validates_schema
    def _catalogue_lists(self, data, **kwargs):
        for field in ("item_categories", "units"):
            value = data.get(field)
            if value is None:
                continue
            if len(value) > 50:
                raise ValidationError("Use at most 50 labels.", field_name=field)


class TermsSchema(Schema):
    scope = fields.String(
        required=True, validate=validate.OneOf(["quotation", "invoice", "both"])
    )
    title = fields.String(required=True, validate=validate.Length(min=1, max=200))
    body = fields.String(required=True, validate=validate.Length(min=1, max=5000))
    is_default = fields.Boolean(load_default=False)


class TermsUpdateSchema(Schema):
    scope = fields.String(validate=validate.OneOf(["quotation", "invoice", "both"]))
    title = fields.String(validate=validate.Length(min=1, max=200))
    body = fields.String(validate=validate.Length(min=1, max=5000))
    is_default = fields.Boolean()


# `load_or_raise` lives in `app.schemas.auth` and is schema-agnostic; import it
# from there rather than duplicating the envelope translation.
from app.schemas.auth import load_or_raise  # noqa: E402

__all__ = ["CompanySettingsSchema", "TermsSchema", "TermsUpdateSchema", "load_or_raise"]
