"""
Ruchita Interiors — NumberingCounter model (§8.3, §12).

One row per (doc_type, year). The counter is only ever bumped inside the same
transaction as the document insert (Phase 5), and a deleted draft's number is
retired — the counter is never decremented.
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow

DOC_TYPES = ("quotation", "invoice")


class NumberingCounter(db.Model):
    __tablename__ = "numbering_counters"
    __table_args__ = (db.UniqueConstraint("doc_type", "year", name="uq_numbering_doc_year"),)

    id = db.Column(db.Integer, primary_key=True)
    doc_type = db.Column(db.String(16), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    last_number = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)
