"""
Ruchita Interiors — Invoices API (§9.2).

Endpoints:
- GET    /invoices                     — list with search/filters/sort/pagination
- GET    /invoices/:id                 — detail with items, computed money, allowed_actions
- PUT    /invoices/:id                 — update Draft fields (dates, notes, terms)
- POST   /invoices/:id/issue           — draft -> issued
- POST   /invoices/:id/cancel          — cancel, releasing the quotation to approved

Deliberately absent: `POST /invoices` (an invoice is only ever created by
converting an approved quotation, FR-I1) and every `/payments` route (Phase 8).
The 404 on the list of routes is the API, not an oversight.

The blueprint stays thin (§23): parse and validate, call the invoice service,
respond in the §9.1 envelope. Every route is `@login_required`; mutations are
also `@csrf_protect` (§16). Response bodies are the service's serialisation, so
the computed figures and `allowed_actions` have exactly one producer.
"""

from __future__ import annotations

from flask import Blueprint, request

from app.schemas import load_or_raise
from app.schemas.quotations import invoice_draft_schema, invoice_list_query_schema
from app.services.csrf import csrf_protect
from app.services.invoices import (
    cancel_invoice,
    get_invoice,
    issue_invoice,
    list_invoices,
    serialize_invoice,
    update_invoice_draft,
)
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
