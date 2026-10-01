"""
Ruchita Interiors — services request schema (SERVICES_PLAN §5, FR-SV1).

One schema serves create and update, like `ClientSchema`: FR-SV1 makes the name
and rate the only required fields, so `PUT /services/:id` is a full replace of
the editable fields under the same rules as create.

Empty text is normalized to `None` before field validation — the UI sends `""`
for a cleared optional field, and that must read as "clear it" rather than trip
a length validator.
"""

from __future__ import annotations

from marshmallow import EXCLUDE, Schema, ValidationError, fields, pre_load, validate, validates

# SERVICES_PLAN §4.1 caps. The name cap matches the column (200); description
# reuses the §16 2000-character text cap.
MAX_NAME = 200
MAX_CATEGORY = 100
MAX_DESCRIPTION = 2000
MAX_UNIT = 50
MAX_RATE_PAISE = 10**12
MAX_QTY_MILLI = 10**12

DEFAULT_UNIT = "job"
DEFAULT_QTY_MILLI = 1000


class ServiceSchema(Schema):
    """Create/update payload for one service (FR-SV1)."""

    class Meta:
        # A forged `archived_at` or `id` is dropped rather than allowed through;
        # archiving is a deliberate endpoint, not an editable field (same as the
        # client schema).
        unknown = EXCLUDE

    name = fields.String(required=True, validate=validate.Length(max=MAX_NAME))
    category = fields.String(allow_none=True, validate=validate.Length(max=MAX_CATEGORY))
    description = fields.String(allow_none=True, validate=validate.Length(max=MAX_DESCRIPTION))
    unit = fields.String(load_default=DEFAULT_UNIT, validate=validate.Length(max=MAX_UNIT))
    default_qty_milli = fields.Integer(
        load_default=DEFAULT_QTY_MILLI,
        validate=validate.Range(min=0, max=MAX_QTY_MILLI),
    )
    # S3: the rate must be strictly positive — the schema is the first gate, and
    # the CHECK constraint on the table is the backstop behind it.
    rate_paise = fields.Integer(
        required=True,
        validate=validate.Range(min=1, max=MAX_RATE_PAISE),
    )

    @pre_load
    def _normalize_text(self, data, **kwargs):
        if not isinstance(data, dict):
            return data
        cleaned = dict(data)
        for key in ("name", "category", "description", "unit"):
            value = cleaned.get(key)
            if isinstance(value, str):
                value = value.strip()
                # `name` stays as-is for the required message below; every other
                # text field becomes None when cleared.
                cleaned[key] = value if key == "name" else (value or None)
        # `unit` is NOT NULL with a default (FR-SV1): a cleared field falls back
        # to `job` via `load_default`, so the key is dropped rather than loaded
        # as null. The service layer keeps `or "job"` as a second net.
        if cleaned.get("unit") is None:
            cleaned.pop("unit", None)
        return cleaned

    @validates("name")
    def _name_required(self, value, **kwargs):
        # `required=True` covers a missing key; this covers `""` and whitespace
        # with a message meant for a person rather than marshmallow's default.
        if not value:
            raise ValidationError("A service name is required.")
        return value

    @validates("rate_paise")
    def _rate_positive(self, value, **kwargs):
        if value is None or value <= 0:
            raise ValidationError("The standard rate must be more than zero.")
        return value


__all__ = ["ServiceSchema"]
