"""
Ruchita Interiors — Quotation/Invoice Marshmallow schemas (§9.1, §10.3).

Validation rules mirror the backend calculation invariants. All money fields
are integers (paise), quantities are milli-units, percentages are basis points.
"""

from __future__ import annotations

from marshmallow import Schema, fields, pre_load, validate, validates, validates_schema, ValidationError

from app.models.quotation import Quotation
from app.models.invoice import Invoice


class QuotationItemSchema(Schema):
    """Schema for a single quotation line item."""

    id = fields.Integer(dump_only=True)
    position = fields.Integer(load_default=0)
    category = fields.String(allow_none=True, load_default=None)
    name = fields.String(required=True, validate=validate.Length(max=200))
    description = fields.String(allow_none=True, load_default=None)
    unit = fields.String(allow_none=True, load_default=None)
    qty_milli = fields.Integer(required=True, validate=validate.Range(min=0, max=10**12))
    rate_paise = fields.Integer(required=True, validate=validate.Range(min=0, max=10**12))
    line_total_paise = fields.Integer(dump_only=True)


class QuotationSchema(Schema):
    """Schema for quotation read/write (header + items)."""

    # Read-only fields
    id = fields.Integer(dump_only=True)
    number = fields.String(dump_only=True)
    year = fields.Integer(dump_only=True)
    subtotal_paise = fields.Integer(dump_only=True)
    discount_paise = fields.Integer(dump_only=True)
    gst_paise = fields.Integer(dump_only=True)
    grand_total_paise = fields.Integer(dump_only=True)
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)
    client_snapshot = fields.Dict(dump_only=True)
    allowed_actions = fields.List(fields.String(), dump_only=True)
    is_expired = fields.Boolean(dump_only=True)

    # Required/editable fields
    client_id = fields.Integer(required=True)
    quotation_date = fields.Date(required=True)
    valid_until = fields.Date(allow_none=True)
    status = fields.String(dump_only=True)

    discount_type = fields.String(
        validate=validate.OneOf(["percent", "fixed"]),
        load_default="percent",
    )
    discount_bp = fields.Integer(allow_none=True, validate=validate.Range(min=0))
    discount_fixed_paise = fields.Integer(allow_none=True, validate=validate.Range(min=0))
    gst_bp = fields.Integer(required=True, validate=validate.Range(min=0, max=2800))
    other_charges_label = fields.String(allow_none=True, load_default="Other Charges", validate=validate.Length(max=200))
    other_charges_paise = fields.Integer(allow_none=True, load_default=0, validate=validate.Range(min=0))

    terms_text = fields.String(allow_none=True, load_default=None)
    notes = fields.String(allow_none=True, load_default=None)

    items = fields.List(fields.Nested(QuotationItemSchema), required=True)

    @validates_schema
    def validate_discount_consistency(self, data, **kwargs):
        """Ensure discount fields match the selected type."""
        discount_type = data.get("discount_type", "percent")
        discount_bp = data.get("discount_bp")
        discount_fixed = data.get("discount_fixed_paise")

        if discount_type == "percent":
            if discount_fixed is not None and discount_fixed != 0:
                raise ValidationError("discount_fixed_paise must be 0 or null when discount_type is 'percent'", "discount_fixed_paise")
        elif discount_type == "fixed":
            if discount_bp is not None and discount_bp != 0:
                raise ValidationError("discount_bp must be 0 or null when discount_type is 'fixed'", "discount_bp")


class QuotationListQuerySchema(Schema):
    """Query params for GET /quotations list."""

    q = fields.String(allow_none=True, load_default=None)
    status = fields.String(allow_none=True, validate=validate.OneOf(["draft", "sent", "approved", "rejected", "converted"]))
    client_id = fields.Integer(allow_none=True)
    date_from = fields.Date(allow_none=True)
    date_to = fields.Date(allow_none=True)
    min_amount = fields.Integer(allow_none=True, validate=validate.Range(min=0))
    max_amount = fields.Integer(allow_none=True, validate=validate.Range(min=0))
    sort = fields.String(allow_none=True, load_default="created_at", validate=validate.OneOf(["created_at", "quotation_date", "grand_total_paise", "client_id"]))
    order = fields.String(allow_none=True, load_default="desc", validate=validate.OneOf(["asc", "desc"]))
    page = fields.Integer(load_default=1, validate=validate.Range(min=1))
    page_size = fields.Integer(load_default=25, validate=validate.Range(min=1, max=100))


class QuotationStatusActionSchema(Schema):
    """Schema for POST /quotations/:id/status action."""

    action = fields.String(required=True, validate=validate.OneOf(["send", "approve", "reject", "reopen"]))
    reason = fields.String(allow_none=True, load_default=None, validate=validate.Length(max=500))


class QuotationDuplicateSchema(Schema):
    """Schema for POST /quotations/:id/duplicate (empty body, but structured for future)."""

    pass


class InvoiceItemSchema(Schema):
    """Schema for invoice line item (mirror of quotation item)."""

    id = fields.Integer(dump_only=True)
    position = fields.Integer(load_default=0)
    category = fields.String(allow_none=True, load_default=None)
    name = fields.String(required=True, validate=validate.Length(max=200))
    description = fields.String(allow_none=True, load_default=None)
    unit = fields.String(allow_none=True, load_default=None)
    qty_milli = fields.Integer(required=True, validate=validate.Range(min=0, max=10**12))
    rate_paise = fields.Integer(required=True, validate=validate.Range(min=0, max=10**12))
    line_total_paise = fields.Integer(dump_only=True)


class InvoiceSchema(Schema):
    """Schema for invoice read (header + items + payments)."""

    id = fields.Integer(dump_only=True)
    number = fields.String(dump_only=True)
    year = fields.Integer(dump_only=True)
    quotation_id = fields.Integer(dump_only=True)
    client_id = fields.Integer(dump_only=True)
    client_snapshot = fields.Dict(dump_only=True)
    issue_date = fields.Date(allow_none=True)
    due_date = fields.Date(allow_none=True)
    status = fields.String(dump_only=True)

    discount_type = fields.String(dump_only=True)
    discount_bp = fields.Integer(dump_only=True)
    discount_fixed_paise = fields.Integer(dump_only=True)
    gst_bp = fields.Integer(dump_only=True)
    other_charges_label = fields.String(dump_only=True)
    other_charges_paise = fields.Integer(dump_only=True)
    subtotal_paise = fields.Integer(dump_only=True)
    discount_paise = fields.Integer(dump_only=True)
    gst_paise = fields.Integer(dump_only=True)
    grand_total_paise = fields.Integer(dump_only=True)

    terms_text = fields.String(dump_only=True)
    bank_snapshot = fields.Dict(dump_only=True)
    signatory_name = fields.String(dump_only=True)
    notes = fields.String(allow_none=True, load_default=None)
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

    items = fields.List(fields.Nested(InvoiceItemSchema), dump_only=True)
    # A Method, not List(Dict()): the relationship holds Payment ORM rows, and
    # List(Dict()) raises TypeError on them. Delegating to PaymentSchema keeps one
    # definition of a payment's wire shape. Populated from Phase 7 onward;
    # recording payments is Phase 8.
    payments = fields.Method("dump_payments", dump_only=True)

    # Computed
    paid_paise = fields.Integer(dump_only=True)
    outstanding_paise = fields.Integer(dump_only=True)
    payment_status = fields.String(dump_only=True)
    allowed_actions = fields.List(fields.String(), dump_only=True)

    def dump_payments(self, obj) -> list:
        rows = getattr(obj, "payments", None) or []
        return [payment_schema.dump(row) for row in rows]


class InvoiceDraftSchema(Schema):
    """Schema for PUT /invoices/:id (draft-only editable fields)."""

    issue_date = fields.Date(allow_none=True)
    due_date = fields.Date(allow_none=True)
    notes = fields.String(allow_none=True, load_default=None)
    terms_text = fields.String(allow_none=True, load_default=None)


class InvoiceListQuerySchema(Schema):
    """Query params for GET /invoices list."""

    q = fields.String(allow_none=True, load_default=None)
    payment_status = fields.String(allow_none=True, validate=validate.OneOf(["unpaid", "partially_paid", "paid"]))
    client_id = fields.Integer(allow_none=True)
    date_from = fields.Date(allow_none=True)
    date_to = fields.Date(allow_none=True)
    sort = fields.String(allow_none=True, load_default="created_at", validate=validate.OneOf(["created_at", "issue_date", "grand_total_paise", "client_id"]))
    order = fields.String(allow_none=True, load_default="desc", validate=validate.OneOf(["asc", "desc"]))
    page = fields.Integer(load_default=1, validate=validate.Range(min=1))
    page_size = fields.Integer(load_default=25, validate=validate.Range(min=1, max=100))


class PaymentSchema(Schema):
    """Schema for payment read/write."""

    id = fields.Integer(dump_only=True)
    invoice_id = fields.Integer(dump_only=True)
    amount_paise = fields.Integer(required=True, validate=validate.Range(min=1))
    paid_on = fields.Date(required=True)
    method = fields.String(required=True, validate=validate.OneOf(["cash", "upi", "bank_transfer", "cheque", "card", "other"]))
    reference = fields.String(allow_none=True, load_default=None, validate=validate.Length(max=120))
    notes = fields.String(allow_none=True, load_default=None)
    created_at = fields.DateTime(dump_only=True)

    @pre_load
    def _reject_fractional_amount(self, data, **kwargs):
        """
        Reject a non-whole paise amount before `fields.Integer` rounds it away.

        Money is integer paise (§11) and this is a write, so a fractional amount is
        a client bug worth surfacing rather than something to absorb. Left to
        itself, `fields.Integer` deserializes `100.9` to `100`: the request would
        succeed and the ledger would record a figure the client never sent, which
        is exactly the kind of quiet disagreement between the sheet and the server
        that D2 exists to prevent.

        Runs as `pre_load` because the check has to see the raw JSON — by the time
        a `validate=` callback runs, the float has already become the integer it
        was truncated to and there is nothing left to catch.

        A whole float (`100.0`) and a numeric string are still accepted: JSON has
        one number type, so a client that cannot help itself may send a float, and
        `100.0` is not a lie about the amount. `True` is rejected because Python
        treats `bool` as an `int`, so it would otherwise become 1 paise.
        """
        if not isinstance(data, dict):
            return data

        amount = data.get("amount_paise")
        if isinstance(amount, bool):
            raise ValidationError(
                "Enter the amount as a whole number of paise.", field_name="amount_paise"
            )
        if isinstance(amount, float) and not amount.is_integer():
            raise ValidationError(
                "Enter the amount as a whole number of paise — paise cannot have a fraction.",
                field_name="amount_paise",
            )
        return data


# Instantiate schemas for reuse
quotation_item_schema = QuotationItemSchema()
quotation_schema = QuotationSchema()
quotation_list_query_schema = QuotationListQuerySchema()
quotation_status_action_schema = QuotationStatusActionSchema()
quotation_duplicate_schema = QuotationDuplicateSchema()

invoice_item_schema = InvoiceItemSchema()
invoice_schema = InvoiceSchema()
invoice_draft_schema = InvoiceDraftSchema()
invoice_list_query_schema = InvoiceListQuerySchema()

payment_schema = PaymentSchema()