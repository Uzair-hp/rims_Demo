"""
Ruchita Interiors — Client model (§8.3).

Phase 3 creates the table via migration; the API itself is Phase 4. Only the
columns and the helpers later phases already depend on live here.
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False, index=True)
    phone = db.Column(db.String(32))
    email = db.Column(db.String(254))
    address = db.Column(db.Text)
    project_address = db.Column(db.Text)
    gstin = db.Column(db.String(15))
    notes = db.Column(db.Text)
    archived_at = db.Column(db.DateTime, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    # ----------------------------------------------------------- archive state

    @property
    def is_archived(self) -> bool:
        """FR-C4: `archived_at` set means the client is hidden from lists/pickers."""
        return self.archived_at is not None

    # ----------------------------------------------------------- serialising

    def to_dict(self) -> dict:
        """Full representation for the Clients list, detail and picker."""
        return {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "address": self.address,
            "project_address": self.project_address,
            "gstin": self.gstin,
            "notes": self.notes,
            "is_archived": self.is_archived,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_snapshot(self) -> dict:
        """
        The contact fields copied onto a quotation at save (§8.3, §8.4).

        Kept next to `to_dict` so the snapshot the quotation stores and the
        profile the UI shows can never drift apart: adding a client field means
        deciding, in one place, whether it belongs in history.
        """
        return {
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "address": self.address,
            "project_address": self.project_address,
            "gstin": self.gstin,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Client id={self.id} name={self.name!r} archived={self.is_archived}>"
