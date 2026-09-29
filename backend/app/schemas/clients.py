"""
Ruchita Interiors — clients request schemas (§9.2, FR-C1).

One schema serves create and update: FR-C1 makes the name the only required
field, so `PUT /clients/:id` is a full replace of the editable fields with the
same rules as create.

Empty text is normalized to `None` before field validation. The UI sends `""` for
a cleared optional field, and `fields.Email` is strict enough to reject an empty
string — normalizing first keeps the contract "clear this field" rather than
"not a valid email".
"""

from __future__ import annotations

from marshmallow import EXCLUDE, Schema, ValidationError, fields, pre_load, validate, validates

# §16 string caps. The name cap matches the column (200) so a valid save can never
# overflow it; notes reuse the 2000-character text cap.
MAX_NAME = 200
MAX_PHONE = 32
MAX_EMAIL = 254
MAX_ADDRESS = 500
MAX_GSTIN = 15
MAX_NOTES = 2000


class ClientSchema(Schema):
    """Create/update payload for one client."""

    class Meta:
        # A forged `archived_at` or `id` is dropped rather than allowed through;
        # archiving is a deliberate endpoint, not an editable field.
        unknown = EXCLUDE

    name = fields.String(required=True, validate=validate.Length(max=MAX_NAME))
    phone = fields.String(allow_none=True, validate=validate.Length(max=MAX_PHONE))
    email = fields.Email(allow_none=True, validate=validate.Length(max=MAX_EMAIL))
    address = fields.String(allow_none=True, validate=validate.Length(max=MAX_ADDRESS))
    project_address = fields.String(allow_none=True, validate=validate.Length(max=MAX_ADDRESS))
    gstin = fields.String(allow_none=True, validate=validate.Length(max=MAX_GSTIN))
    notes = fields.String(allow_none=True, validate=validate.Length(max=MAX_NOTES))

    @pre_load
    def _normalize_text(self, data, **kwargs):
        if not isinstance(data, dict):
            return data
        cleaned = dict(data)
        for key in ("name", "phone", "email", "address", "project_address", "gstin", "notes"):
            value = cleaned.get(key)
            if isinstance(value, str):
                value = value.strip()
                # `name` stays as-is for the message below; every optional field
                # becomes None when cleared.
                cleaned[key] = value if key == "name" else (value or None)
        return cleaned

    @validates("name")
    def _name_required(self, value, **kwargs):
        # `required=True` covers a missing key; this covers `""` and whitespace
        # with a message meant for a person rather than marshmallow's default.
        if not value:
            raise ValidationError("A client name is required.")
        return value


__all__ = ["ClientSchema"]