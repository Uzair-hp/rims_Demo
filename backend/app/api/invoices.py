"""
Ruchita Interiors — Invoices API (§9.2).

Endpoints:
- GET    /invoices                     — list with search/filters/sort/pagination
- GET    /invoices/:id                 — detail with items, computed money, allowed_actions
- PUT    /invoices/:id                 — update Draft fields (dates, notes, terms)
- POST   /invoices/:id/issue           — draft -> issued
- POST   /invoices/:id/cancel          — cancel, releasing the quotation to approved
- GET    /invoices/:id/payments        — payment history, newest first
- POST   /invoices/:id/payments        — record a payment (rejects overpayment)

Deliberately absent: `POST /invoices` (an invoice is only ever created by
converting an approved quotation, FR-I1). That 404 is the API, not an oversight.

`DELETE /payments/:id` lives in the sibling `payments.py` blueprint, because §9.2
scopes it to a payment rather than to an invoice.

The blueprint stays thin (§23): parse and validate, call the invoice service,
respond in the §9.1 envelope. Every route is `@login_required`; mutations are
also `@csrf_protect` (§16). Response bodies are the service's serialisation, so
the computed figures and `allowed_actions` have exactly one producer.
"""

from __future__ import annotations

from flask import Blueprint, g, request

from app.schemas import load_or_raise
from app.schemas.quotations import (
    invoice_draft_schema,
    invoice_list_query_schema,
    payment_schema,
)
from app.services.csrf import csrf_protect
from app.services.invoices import (
    cancel_invoice,
    get_invoice,
    issue_invoice,
    list_invoices,
    payment_due_document,
    serialize_invoice,
    update_invoice_draft,
)
from app.services.payments import list_payments, record_payment
from app.utils.errors import success
from app.utils.guards import login_required

invoices_bp = Blueprint("invoices", __name__, url_prefix="/invoices")


@invoices_bp.get("")
@login_required
def list_invoices_route():
    """GET /invoices — list with search/filters/sort/pagination."""
    params = load_or_raise(invoice_list_query_schema, request.args.to_dict())
    page = params.pop("page")
    page_size = params.pop("page_size")

    items, total = list_invoices(page=page, page_size=page_size, **params)

    return success(
        {
            "items": [serialize_invoice(invoice) for invoice in items],
            "page": page,
            "page_size": page_size,
            "total": total,
        }
    )


@invoices_bp.get("/<int:invoice_id>")
@login_required
def get_invoice_route(invoice_id: int):
    """GET /invoices/:id — detail with items, paid/outstanding, allowed_actions."""
    invoice = get_invoice(invoice_id)
    return success({"invoice": serialize_invoice(invoice)})


@invoices_bp.put("/<int:invoice_id>")
@login_required
@csrf_protect
def update_invoice_route(invoice_id: int):
    """PUT /invoices/:id — update the editable Draft fields only."""
    invoice = get_invoice(invoice_id)
    data = load_or_raise(invoice_draft_schema, request.get_json(silent=True) or {})
    updated = update_invoice_draft(invoice, data)
    return success({"invoice": serialize_invoice(updated)})


@invoices_bp.post("/<int:invoice_id>/issue")
@login_required
@csrf_protect
def issue_invoice_route(invoice_id: int):
    """POST /invoices/:id/issue — draft -> issued. Items are already locked (§8.4)."""
    invoice = issue_invoice(get_invoice(invoice_id))
    return success({"invoice": serialize_invoice(invoice)})


@invoices_bp.post("/<int:invoice_id>/cancel")
@login_required
@csrf_protect
def cancel_invoice_route(invoice_id: int):
    """
    POST /invoices/:id/cancel — cancel and release the quotation (§13.2).

    Refused with 409 when the invoice has payments: money has been taken, and the
    correction is a payment deletion (Phase 8), not a cancel.
    """
    invoice = cancel_invoice(get_invoice(invoice_id))
    return success({"invoice": serialize_invoice(invoice)})


@invoices_bp.get("/<int:invoice_id>/payments")
@login_required
def list_invoice_payments_route(invoice_id: int):
    """GET /invoices/:id/payments — payment history, newest first."""
    invoice = get_invoice(invoice_id)
    payments = list_payments(invoice)
    # Serialised once: it is the single producer of the derived figures, and it
    # is not free.
    figures = serialize_invoice(invoice)
    return success(
        {
            "payments": [payment_schema.dump(payment) for payment in payments],
            "paid_paise": figures["paid_paise"],
            "outstanding_paise": figures["outstanding_paise"],
            "payment_status": figures["payment_status"],
        }
    )


@invoices_bp.get("/<int:invoice_id>/payment-due")
@login_required
def payment_due_document_route(invoice_id: int):
    """
    GET /invoices/:id/payment-due — the Balance / Payment Due document (§8.5).

    **A read.** No `@csrf_protect`, because nothing is mutated, and no write happens
    anywhere in this path: no invoice row, no payment row, no stored balance. The
    document is re-derived from the invoice and its payment ledger on every call, so
    it is correct by construction and cannot go stale — and generating one can never
    add revenue, because `dashboard.py` and `clients.py` sum the `invoices` table and
    this endpoint never writes to it.

    It carries no document number of its own. It is referenced by the invoice it
    concerns, which is the only identity it needs, and giving a collection notice a
    second number would read as a second sale.

    Refused with 422 only when the invoice is not issued: a draft has not been billed
    and a cancelled one must never produce a demand for money. A **fully paid** invoice
    is answered with 200 and `fully_paid: true` instead — that is a state a customer
    reaches by doing the right thing, and the sheet it produces is a settlement
    statement with no QR and no bank details, not an error. A zero-amount QR is still
    impossible: the amount fed to `build_upi_uri` is non-positive when settled, so the
    URI comes back `None`.
    """
    return success({"payment_due": payment_due_document(get_invoice(invoice_id))})


@invoices_bp.post("/<int:invoice_id>/payments")
@login_required
@csrf_protect
def record_invoice_payment_route(invoice_id: int):
    """
    POST /invoices/:id/payments — record a payment against an issued invoice.

    Returns the refreshed invoice as well as the payment, because the client must
    re-render from the server's computed figures rather than from its own
    arithmetic (D2). An overpayment is a 422 BUSINESS_RULE (§11).
    """
    invoice = get_invoice(invoice_id)
    data = load_or_raise(payment_schema, request.get_json(silent=True))
    payment = record_payment(invoice, data, created_by=g.current_user.id)
    return success(
        {"payment": payment_schema.dump(payment), "invoice": serialize_invoice(invoice)},
        status=201,
    )
