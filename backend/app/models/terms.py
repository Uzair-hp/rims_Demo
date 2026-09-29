"""
Ruchita Interiors — TermsConditions model (§8.3).

Default terms per document scope. New documents snapshot the chosen default's
body into `terms_text`, so later edits never rewrite issued documents (§8.4).
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow

SCOPES = ("quotation", "invoice", "both")


class TermsConditions(db.Model):
    __tablename__ = "terms_conditions"

    id = db.Column(db.Integer, primary_key=True)
    scope = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    is_default = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "scope": self.scope,
            "title": self.title,
            "body": self.body,
            "is_default": bool(self.is_default),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
