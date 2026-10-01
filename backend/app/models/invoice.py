"""
Ruchita Interiors — Invoice, InvoiceItem and Payment models (§8.3).

Phase 3 creates the tables via migration; conversion (Phase 7) and payments
(Phase 8) operate on them later. The partial unique index on
`invoices.quotation_id` is what enforces "one active invoice per quotation,
re-invoice allowed after cancel" — declared in the migration because SQLite
partial indexes are not expressible in the ORM declaration alone.
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow


class Invoice(db.Model):
    __tablename__ = "invoices"
    # §8.3: one active invoice per quotation — the partial unique index below is
    # the constraint that makes re-invoice-after-cancel possible while still
    # blocking duplicates. Cancelled invoices release their quotation.
    __table_args__ = (
        db.Index(
            "uq_invoices_active_quotation",
            "quotation_id",
            unique=True,
            sqlite_where=db.text("status != 'cancelled'"),
        ),
        db.CheckConstraint(
            "status IN ('draft','issued','cancelled')",
            name="ck_invoices_status",
        ),
        # The payment *presentation* chosen before issue. NULL is "Not Selected",
        # which prints both UPI and bank transfer. Distinct from payments.method,
        # which records how the client actually paid and is never copied here.
        db.CheckConstraint(
            "payment_method IS NULL OR payment_method IN "
            "('upi','bank_transfer','cash')",
            name="ck_invoices_payment_method",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(32), nullable=False, unique=True)
    year = db.Column(db.Integer, nullable=False)
    quotation_id = db.Column(db.Integer, db.ForeignKey("quotations.id"), index=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    client_snapshot = db.Column(db.JSON)
    issue_date = db.Column(db.Date)
    due_date = db.Column(db.Date)
    status = db.Column(db.String(16), nullable=False, server_default="draft")

    # Calc fields mirrored from the quotation at conversion (§8.3), recomputed
    # and stored there — never recalculated from Settings afterwards.
    discount_type = db.Column(db.String(8))
    discount_bp = db.Column(db.Integer)
    discount_fixed_paise = db.Column(db.Integer)
    gst_bp = db.Column(db.Integer)
    other_charges_label = db.Column(db.String(200))
    other_charges_paise = db.Column(db.Integer)
    subtotal_paise = db.Column(db.Integer)
    discount_paise = db.Column(db.Integer)
    gst_paise = db.Column(db.Integer)
    grand_total_paise = db.Column(db.Integer)

    terms_text = db.Column(db.Text)
    # How this invoice presents its payment options, chosen while draft and frozen
    # at issue by the draft-only edit guard. See migration b8d5f0e2c7a1.
    payment_method = db.Column(db.String(16))
    bank_snapshot = db.Column(db.JSON)
    signatory_name = db.Column(db.String(200))
    notes = db.Column(db.Text)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    items = db.relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceItem.position",
    )
    # Newest first, pinned rather than left to whatever order the query returns:
    # the same ordering `services/clients._payments_for` uses, so the invoice
    # detail and the client summary list a payment history identically. Payment
    # was added by Phase 3 and first written by Phase 8; before this it had no
    # ordering at all, which made the history order incidental.
    payments = db.relationship(
        "Payment",
        back_populates="invoice",
        order_by=lambda: (Payment.paid_on.desc(), Payment.id.desc()),
    )


class InvoiceItem(db.Model):
    __tablename__ = "invoice_items"
    __table_args__ = (
        db.Index("ix_invoice_items_invoice_position", "invoice_id", "position"),
        db.CheckConstraint("qty_milli >= 0", name="ck_invoice_items_qty_nonnegative"),
        db.CheckConstraint("rate_paise >= 0", name="ck_invoice_items_rate_nonnegative"),
    )

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer,
        db.ForeignKey("invoices.id", ondelete="RESTRICT"),
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
    # SERVICES_PLAN §4.2/§8.4 (Phase 9A): copied from the quotation item at
    # conversion so the invoice carries the same provenance snapshot. Never
    # written by the client and never read by the calculation core (S7).
    service_id = db.Column(db.Integer, db.ForeignKey("services.id", ondelete="RESTRICT"))
    catalog_rate_paise = db.Column(db.Integer)

    invoice = db.relationship("Invoice", back_populates="items")


class Payment(db.Model):
    __tablename__ = "payments"
    # §8.3: amounts are strictly positive and the method comes from the fixed
    # list the payment sheet offers (Phase 8).
    __table_args__ = (
        db.CheckConstraint("amount_paise > 0", name="ck_payments_amount_positive"),
        db.CheckConstraint(
            "method IN ('cash','upi','bank_transfer','cheque','card','other')",
            name="ck_payments_method",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer,
        db.ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    amount_paise = db.Column(db.Integer, nullable=False)
    paid_on = db.Column(db.Date, nullable=False)
    method = db.Column(db.String(16), nullable=False)
    reference = db.Column(db.String(120))
    notes = db.Column(db.Text)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    invoice = db.relationship("Invoice", back_populates="payments")
