"""
Ruchita Interiors — Quotation and QuotationItem models (§8.3).

Phase 3 creates the tables via migration; the quotation engine is Phase 5. The
models carry the §8.1 integer primitives (paise, milli-units, basis points) and
the CHECK constraints §8.3 lists, so a bad row is a database error and not a
silent zero.
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow


class Quotation(db.Model):
    __tablename__ = "quotations"
    # §8.3: the status column is CHECK-constrained, so an impossible state cannot
    # be written even by a bug in a later phase.
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('draft','sent','approved','rejected','converted')",
            name="ck_quotations_status",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(32), nullable=False, unique=True)
    year = db.Column(db.Integer, nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    client_snapshot = db.Column(db.JSON)
    quotation_date = db.Column(db.Date, nullable=False)
    valid_until = db.Column(db.Date)
    status = db.Column(db.String(16), nullable=False, server_default="draft")

    discount_type = db.Column(db.String(8))
    discount_bp = db.Column(db.Integer)
    discount_fixed_paise = db.Column(db.Integer)
    gst_bp = db.Column(db.Integer)
    other_charges_label = db.Column(db.String(200), server_default="Other Charges")
    other_charges_paise = db.Column(db.Integer)

    # Cached totals, recomputed server-side on every save (§8.3) — Phase 5.
    subtotal_paise = db.Column(db.Integer)
    discount_paise = db.Column(db.Integer)
    gst_paise = db.Column(db.Integer)
    grand_total_paise = db.Column(db.Integer)

    terms_text = db.Column(db.Text)
    notes = db.Column(db.Text)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    archived_at = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    items = db.relationship(
        "QuotationItem",
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="QuotationItem.position",
    )


class QuotationItem(db.Model):
    __tablename__ = "quotation_items"
    __table_args__ = (
        db.Index("ix_quotation_items_quotation_position", "quotation_id", "position"),
        db.CheckConstraint("qty_milli >= 0", name="ck_quotation_items_qty_nonnegative"),
        db.CheckConstraint("rate_paise >= 0", name="ck_quotation_items_rate_nonnegative"),
    )

    id = db.Column(db.Integer, primary_key=True)
    quotation_id = db.Column(
        db.Integer,
        db.ForeignKey("quotations.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    category = db.Column(db.String(100))
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    unit = db.Column(db.String(50))
    qty_milli = db.Column(db.Integer, server_default="0")
    rate_paise = db.Column(db.Integer, server_default="0")
    line_total_paise = db.Column(db.Integer)
    # SERVICES_PLAN §4.2 (Phase 9A): catalog provenance, informational only (S7).
    # The FK is RESTRICT, which is safe because services are never hard-deleted
    # (S5); the catalog rate is the standard rate at the moment the line was added
    # and is display metadata only — nothing in calculations.py reads either field.
    service_id = db.Column(db.Integer, db.ForeignKey("services.id", ondelete="RESTRICT"))
    catalog_rate_paise = db.Column(db.Integer)

    quotation = db.relationship("Quotation", back_populates="items")
