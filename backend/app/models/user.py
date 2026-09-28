"""
Ruchita Interiors — User model.

Schema per §8.3. There is exactly one account (FR-A4), created from environment
variables by `flask seed-admin`; there is no signup, no password reset and no
email delivery in this system.

Deviation from §8.3, agreed during Phase 2:

- `token_version` is an extra integer column. §25 requires that changing the
  password invalidates existing sessions and that logout clears server-side, but
  a stateless JWT cannot be revoked and §8.3 has no column to revoke against.
  Bumping `token_version` invalidates every previously issued refresh token in
  one write, with no extra table.

`role` exists for a future multi-user system. No authorization logic reads it
yet, because there is only ever one user (§1.3).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions.database import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(32), nullable=False, default="owner", server_default="owner")
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    token_version = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    # ----------------------------------------------------------- passwords

    def set_password(self, raw_password: str) -> None:
        """Hash with scrypt (§16). The raw password is never stored or logged."""
        self.password_hash = generate_password_hash(raw_password, method="scrypt")

    def check_password(self, raw_password: str) -> bool:
        """Constant-time verification, per §16."""
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, raw_password)

    # ------------------------------------------------------------- sessions

    def revoke_sessions(self) -> None:
        """
        Invalidate every refresh token issued before now.

        Called on logout and on password change. The next refresh request carries
        a stale `tv` claim and is rejected.
        """
        self.token_version = (self.token_version or 0) + 1

    # ---------------------------------------------------------- serialising

    def to_dict(self) -> dict:
        """
        Public representation.

        `password_hash` and `token_version` are deliberately absent: the first is
        a credential, the second is internal. §16 requires a password never to be
        returned.
        """
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User id={self.id} email={self.email!r}>"


# A real scrypt hash of a value nobody knows, generated once at import.
#
# `verify_dummy` exists so a login attempt against a non-existent account still
# performs a full scrypt verification. Without it, "no such account" would return
# in the time of one indexed lookup while "wrong password" takes the ~100ms of a
# scrypt hash - a timing difference an attacker can use to enumerate accounts
# (§25). The result is discarded; only the cost matters.
_DUMMY_PASSWORD_HASH = generate_password_hash(secrets.token_urlsafe(32), method="scrypt")


def verify_dummy(raw_password: str) -> bool:
    """
    Burn the same CPU as a real password check, then return False.

    Always False, so it can be dropped into a rejection without changing the
    outcome - the only reason to call it is the time it takes.
    """
    check_password_hash(_DUMMY_PASSWORD_HASH, raw_password)
    return False
