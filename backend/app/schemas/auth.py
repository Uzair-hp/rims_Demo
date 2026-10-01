"""
Ruchita Interiors — auth request schemas.

Marshmallow 4 syntax (`load_default`, not the removed `missing`/`default`).

Validation errors are translated into the §9.1 envelope with one entry per field,
so the login form can render a message under the right input instead of showing a
single opaque banner.
"""

from __future__ import annotations

from marshmallow import Schema, ValidationError, fields, validate, validates_schema

from app.config.settings import settings
from app.utils.errors import ApiError

# §16 caps on string length, so a malicious client cannot push an unbounded
# string through the password check.
MAX_EMAIL_LENGTH = 254
MAX_PASSWORD_LENGTH = 256
MAX_NAME_LENGTH = 120


class LoginSchema(Schema):
    email = fields.Email(required=True, validate=validate.Length(max=MAX_EMAIL_LENGTH))
    # No minimum length here: rejecting a short password at the schema would make
    # the response distinguishable from a wrong password, which is the user
    # enumeration risk §25 forbids. Length is enforced only when *setting* one.
    password = fields.String(required=True, validate=validate.Length(max=MAX_PASSWORD_LENGTH))


class ChangePasswordSchema(Schema):
    # Capped like the login password. It reaches `check_password_hash`, so an
    # uncapped string is an unbounded scrypt input on an endpoint that is
    # authenticated but not rate limited.
    current_password = fields.String(
        required=True, validate=validate.Length(max=MAX_PASSWORD_LENGTH)
    )
    new_password = fields.String(
        required=True,
        validate=validate.Length(min=settings.PASSWORD_MIN_LENGTH, max=MAX_PASSWORD_LENGTH),
    )

    @validates_schema
    def _passwords_differ(self, data, **kwargs):
        if data.get("current_password") == data.get("new_password"):
            raise ValidationError("The new password must be different from the current one.", field_name="new_password")


def load_or_raise(schema: Schema, payload: dict | None) -> dict:
    """
    Run a schema and convert failures into the standard error envelope.

    Marshmallow reports a dict of field -> messages; §9.1 wants a list of
    `{field, message}` objects, so the shape is translated here rather than in
    every endpoint.
    """
    try:
        return schema.load(payload or {})
    except ValidationError as error:
        details = [
            {"field": field, "message": message}
            for field, messages in error.messages.items()
            for message in (messages if isinstance(messages, list) else [messages])
        ]
        first = details[0]["message"] if details else "Invalid request."
        raise ApiError("VALIDATION_ERROR", first, details) from error
