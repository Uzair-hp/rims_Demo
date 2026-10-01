"""
Ruchita Interiors — clients request schemas (§9.2, FR-C1).

One schema serves create and update: FR-C1 makes the name and the phone number
the required fields, so `PUT /clients/:id` is a full replace of the editable
fields with the same rules as create.

Empty text is normalized to `None` before field validation. The UI sends `""` for
a cleared optional field, and `fields.Email` is strict enough to reject an empty
string — normalizing first keeps the contract "clear this field" rather than
"not a valid email".

The phone number is reduced to ten bare digits by `@post_load`, and the email is
lowercased, both before the payload reaches the service. See
`app/utils/phone.py` for why the digits are the stored form.
"""

from __future__ import annotations

from marshmallow import (
    EXCLUDE,
    Schema,
    ValidationError,
    fields,
    post_load,
    pre_load,
    validate,
    validates,
)

from app.utils.phone import PHONE_ERROR, normalize_phone

# §16 string caps. The name cap matches the column (200) so a valid save can never
# overflow it; notes reuse the 2000-character text cap.
MAX_NAME = 200
MAX_PHONE = 32
MAX_EMAIL = 254
MAX_ADDRESS = 500
MAX_GSTIN = 15
MAX_NOTES = 2000


class ClientSchema(Schema):
    """
    Create/update payload for one client.

    The phone number is **required** and stored as ten bare digits. It is the one
    field a business reliably has for every customer, and making it required is
    what lets the app phone, SMS or WhatsApp a client without a second lookup.
    """

    class Meta:
        # A forged `archived_at` or `id` is dropped rather than allowed through;
        # archiving is a deliberate endpoint, not an editable field.
        unknown = EXCLUDE

    name = fields.String(required=True, validate=validate.Length(max=MAX_NAME))
    phone = fields.String(required=True, validate=validate.Length(max=MAX_PHONE))
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
                cleaned[key] = value if key in ("name", "phone") else (value or None)
        # An email is a lookup key, so it is folded to one case here. A mail server
        # treats the domain case-insensitively and in practice the local part is
        # too; storing whatever case was typed is what lets one person become two
        # clients.
        email = cleaned.get("email")
        if isinstance(email, str):
            cleaned["email"] = email.lower() or None
        return cleaned

    @validates("name")
    def _name_required(self, value, **kwargs):
        # `required=True` covers a missing key; this covers `""` and whitespace
        # with a message meant for a person rather than marshmallow's default.
        if not value:
            raise ValidationError("A client name is required.")
        return value

    @validates("phone")
    def _phone_is_a_mobile_number(self, value, **kwargs):
        """
        Reject anything that is not a usable mobile number.

        Validation only, deliberately: a `@validates` hook that *returned* the
        normalised digits would be ignored, because marshmallow keeps the
        deserialised field value and discards the hook's return. The canonical
        form is therefore written by `_canonical_phone` in `@post_load`, which
        runs once and is the only place the stored shape is decided.
        """
        if normalize_phone(value) is None:
            raise ValidationError(PHONE_ERROR)
        return value

    @post_load
    def _canonical_phone(self, data, **kwargs):
        """
        Store the number as the ten bare digits `normalize_phone` reduces it to.

        This is what makes a duplicate check or a search meaningful: `+91 90000
        12345`, `090000-12345` and `9000012345` are one client, not three. The
        column stays a nullable string so the pre-existing rows this cannot fix
        keep working; only a *write* goes through here.
        """
        phone = data.get("phone")
        if phone is not None:
            data["phone"] = normalize_phone(phone) or phone
        return data


__all__ = ["ClientSchema"]