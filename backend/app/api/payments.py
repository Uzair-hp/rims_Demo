"""
Ruchita Interiors — Payments API (§9.2).

Endpoints:
- DELETE /payments/:id — delete a payment as a correction

Recording and listing live under the invoice they belong to
(`api/invoices.py`: `GET|POST /invoices/:id/payments`), because §9.2 scopes those
to the invoice. Only the delete is scoped to a payment, so only the delete is
here — a payment is reachable on its own solely to be removed.

The blueprint stays thin (§23) and follows the same guard shape as every other
mutating route in the project: `@login_required` plus `@csrf_protect` (§16).
"""

from __future__ import annotations

from flask import Blueprint

from app.schemas.quotations import payment_schema
from app.services.csrf import csrf_protect
from app.services.invoices import get_invoice, serialize_invoice
from app.services.payments import delete_payment, get_payment
from app.utils.errors import success
from app.utils.guards import login_required

payments_bp = Blueprint("payments", __name__, url_prefix="/payments")


@payments_bp.delete("/<int:payment_id>")
@login_required
@csrf_protect
def delete_payment_route(payment_id: int):
    """
    DELETE /payments/:id — remove a payment and report the corrected invoice.

    The invoice comes back because deleting a payment changes what the client is
    looking at (§11: paid/outstanding/status are derived, so the next read already
    reflects the correction). Returning it saves a second round trip and keeps
    the UI rendering the server's numbers rather than its own arithmetic (D2).
    """
    payment = get_payment(payment_id)
    invoice = get_invoice(payment.invoice_id)
    deleted_id = payment.id

    delete_payment(payment)

    return success(
        {
            "deleted": deleted_id,
            "invoice": serialize_invoice(invoice),
        }
    )
