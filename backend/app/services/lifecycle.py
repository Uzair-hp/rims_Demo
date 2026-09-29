"""
Ruchita Interiors — Quotation/Invoice lifecycle service (§13).

Encapsulates the state machines and exposes `allowed_actions` so the UI
renders exactly what the server permits — single source of truth, no
client-side state bugs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Literal

from app.models.quotation import Quotation
from app.models.invoice import Invoice


class QuotationAction(str, Enum):
    SEND = "send"
    APPROVE = "approve"
    REJECT = "reject"
    REOPEN = "reopen"
    DUPLICATE = "duplicate"
    DELETE = "delete"
    CREATE_INVOICE = "create_invoice"


class InvoiceAction(str, Enum):
    ISSUE = "issue"
    CANCEL = "cancel"
    RECORD_PAYMENT = "record_payment"
    DELETE_PAYMENT = "delete_payment"
    DUPLICATE = "duplicate"
    DELETE = "delete"


QuotationStatus = Literal["draft", "sent", "approved", "rejected", "converted"]
InvoiceStatus = Literal["draft", "issued", "cancelled"]


# ---- Status transition guards (quotation) ----

QUOTATION_TRANSITIONS: dict[QuotationStatus, dict[QuotationAction, QuotationStatus]] = {
    "draft": {
        QuotationAction.SEND: "sent",
        QuotationAction.DELETE: "deleted",  # handled separately
        QuotationAction.DUPLICATE: "draft",
    },
    "sent": {
        QuotationAction.APPROVE: "approved",
        QuotationAction.REJECT: "rejected",
        QuotationAction.REOPEN: "draft",
        QuotationAction.DUPLICATE: "draft",
    },
    "approved": {
        QuotationAction.CREATE_INVOICE: "converted",
        QuotationAction.DUPLICATE: "draft",
        QuotationAction.REJECT: "rejected",
    },
    "rejected": {
        QuotationAction.DUPLICATE: "draft",
        QuotationAction.DELETE: "deleted",
    },
    "converted": {
        QuotationAction.DUPLICATE: "draft",
    },
}


# ---- Status transition guards (invoice) ----

INVOICE_TRANSITIONS: dict[InvoiceStatus, dict[InvoiceAction, InvoiceStatus]] = {
    "draft": {
        InvoiceAction.ISSUE: "issued",
        InvoiceAction.CANCEL: "cancelled",
        InvoiceAction.DELETE: "deleted",
        InvoiceAction.DUPLICATE: "draft",
    },
    "issued": {
        InvoiceAction.RECORD_PAYMENT: "issued",  # status stays, payment_status changes
        InvoiceAction.CANCEL: "cancelled",
        InvoiceAction.DUPLICATE: "draft",
    },
    "cancelled": {
        InvoiceAction.DUPLICATE: "draft",
    },
}


# ---- Validation helpers ----

def _has_valid_lines(quotation: Quotation) -> bool:
    """Check if quotation has at least one valid line (name, qty>0, rate>0)."""
    return any(
        item.name.strip() and item.qty_milli > 0 and item.rate_paise > 0
        for item in quotation.items
    )


def _is_expired(quotation: Quotation) -> bool:
    """Check if quotation is expired (status in {draft, sent} and valid_until < today)."""
    if quotation.status not in ("draft", "sent"):
        return False
    if quotation.valid_until is None:
        return False
    return quotation.valid_until < date.today()


def _can_send(quotation: Quotation) -> tuple[bool, str | None]:
    """Guard for draft → sent."""
    if not quotation.client_id:
        return False, "Client is required"
    if not _has_valid_lines(quotation):
        return False, "All items need name, quantity and rate"
    if quotation.grand_total_paise is None or quotation.grand_total_paise <= 0:
        return False, "Grand total must be positive"
    return True, None


def _can_approve(quotation: Quotation) -> tuple[bool, str | None]:
    """Guard for sent → approved."""
    if _is_expired(quotation):
        return False, "Quotation has expired — extend validity first"
    return True, None


def _can_reopen(quotation: Quotation) -> tuple[bool, str | None]:
    """Guard for sent → draft."""
    if quotation.status != "sent":
        return False, "Only sent quotations can be reopened"
    return True, None


def _can_create_invoice(quotation: Quotation) -> tuple[bool, str | None]:
    """Guard for approved → converted (via invoice creation)."""
    if quotation.status != "approved":
        return False, "Only approved quotations can be converted to invoice"
    # The unique constraint on invoices.quotation_id (partial) handles duplicate check
    return True, None


def _can_issue_invoice(invoice: Invoice) -> tuple[bool, str | None]:
    """Guard for draft → issued."""
    if not _has_valid_lines(invoice):
        return False, "All items need name, quantity and rate"
    if invoice.grand_total_paise is None or invoice.grand_total_paise <= 0:
        return False, "Grand total must be positive"
    return True, None


def _can_cancel_invoice(invoice: Invoice) -> tuple[bool, str | None]:
    """Guard for issued → cancelled."""
    if invoice.payments:
        return False, "Cannot cancel invoice with payments"
    return True, None


# ---- Public API ----

@dataclass(frozen=True)
class AllowedActions:
    """Actions available for the current document state."""
    actions: list[str]
    can_send: bool = False
    can_approve: bool = False
    can_reject: bool = False
    can_reopen: bool = False
    can_duplicate: bool = False
    can_delete: bool = False
    can_create_invoice: bool = False
    can_issue: bool = False
    can_cancel: bool = False
    can_record_payment: bool = False
    is_expired: bool = False
    expired_reason: str | None = None

    def to_list(self) -> list[str]:
        return self.actions


def get_quotation_allowed_actions(quotation: Quotation) -> AllowedActions:
    """
    Compute allowed actions for a quotation based on its current state.

    Returns an AllowedActions object with boolean flags and an action list
    that the frontend can directly render.
    """
    status: QuotationStatus = quotation.status
    actions = []

    expired = _is_expired(quotation)

    # Duplicate is always available — every state can seed a fresh draft,
    # including converted (the quotation is history, the copy is new work).
    actions.append(QuotationAction.DUPLICATE.value)
    can_duplicate = True

    # Draft actions
    if status == "draft":
        can_send, send_reason = _can_send(quotation)
        if can_send:
            actions.append(QuotationAction.SEND.value)
        can_delete = True
        actions.append(QuotationAction.DELETE.value)
        can_reopen = False
        can_approve = False
        can_reject = False
        can_create_invoice = False

    # Sent actions
    elif status == "sent":
        can_approve, approve_reason = _can_approve(quotation)
        if can_approve:
            actions.append(QuotationAction.APPROVE.value)
        actions.append(QuotationAction.REJECT.value)
        can_reject = True
        can_reopen, _ = _can_reopen(quotation)
        if can_reopen:
            actions.append(QuotationAction.REOPEN.value)
        can_send = False
        can_delete = False
        can_create_invoice = False

    # Approved actions
    elif status == "approved":
        can_create_invoice, _ = _can_create_invoice(quotation)
        if can_create_invoice:
            actions.append(QuotationAction.CREATE_INVOICE.value)
        actions.append(QuotationAction.REJECT.value)
        can_reject = True
        can_send = False
        can_reopen = False
        can_delete = False
        can_approve = False

    # Rejected actions
    elif status == "rejected":
        can_delete = True
        actions.append(QuotationAction.DELETE.value)
        can_send = False
        can_approve = False
        can_reopen = False
        can_reject = False
        can_create_invoice = False

    # Converted actions
    elif status == "converted":
        can_delete = False
        can_send = False
        can_approve = False
        can_reopen = False
        can_reject = False
        can_create_invoice = False

    else:
        can_send = can_approve = can_reject = can_reopen = can_duplicate = can_delete = can_create_invoice = False

    return AllowedActions(
        actions=actions,
        can_send=can_send,
        can_approve=can_approve,
        can_reject=can_reject,
        can_reopen=can_reopen,
        can_duplicate=can_duplicate,
        can_delete=can_delete,
        can_create_invoice=can_create_invoice,
        is_expired=expired,
        expired_reason="Quotation validity period has passed" if expired else None,
    )


def get_invoice_allowed_actions(invoice: Invoice) -> AllowedActions:
    """
    Compute allowed actions for an invoice based on its current state.
    """
    status: InvoiceStatus = invoice.status
    actions = []

    # Always available
    actions.append(InvoiceAction.DUPLICATE.value)
    can_duplicate = True

    if status == "draft":
        can_issue, _ = _can_issue_invoice(invoice)
        if can_issue:
            actions.append(InvoiceAction.ISSUE.value)
        actions.append(InvoiceAction.CANCEL.value)
        actions.append(InvoiceAction.DELETE.value)
        can_cancel = True
        can_delete = True
        can_record_payment = False

    elif status == "issued":
        actions.append(InvoiceAction.RECORD_PAYMENT.value)
        can_record_payment = True
        can_cancel, _ = _can_cancel_invoice(invoice)
        if can_cancel:
            actions.append(InvoiceAction.CANCEL.value)
        can_issue = False
        can_delete = False

    elif status == "cancelled":
        can_cancel = False
        can_issue = False
        can_record_payment = False
        can_delete = False

    else:
        can_issue = can_cancel = can_record_payment = can_delete = False

    return AllowedActions(
        actions=actions,
        can_issue=can_issue,
        can_cancel=can_cancel,
        can_record_payment=can_record_payment,
        can_duplicate=can_duplicate,
        can_delete=can_delete,
    )


def validate_quotation_transition(quotation: Quotation, action: QuotationAction) -> tuple[bool, str | None]:
    """
    Validate a quotation state transition. Returns (allowed, error_message).

    Two gates: the action must be legal for the current status (transition
    table), and any action-specific guard (valid lines, not expired, …) must
    pass. The status gate is what stops e.g. approving straight from draft.
    """
    # Duplicate seeds a fresh draft and is legal from every state.
    if action == QuotationAction.DUPLICATE:
        return True, None

    # Delete is only ever legal for draft/rejected.
    if action == QuotationAction.DELETE:
        if quotation.status not in ("draft", "rejected"):
            return False, "Only draft or rejected quotations can be deleted"
        return True, None

    allowed_for_status = QUOTATION_TRANSITIONS.get(quotation.status, {})
    if action not in allowed_for_status:
        return False, f"Cannot {action.value} a quotation in status '{quotation.status}'"

    if action == QuotationAction.SEND:
        return _can_send(quotation)
    elif action == QuotationAction.APPROVE:
        return _can_approve(quotation)
    elif action == QuotationAction.REOPEN:
        return _can_reopen(quotation)
    elif action == QuotationAction.CREATE_INVOICE:
        return _can_create_invoice(quotation)
    elif action == QuotationAction.REJECT:
        return True, None  # legal from sent/approved per the transition table

    return False, f"Unknown action: {action}"


def validate_invoice_transition(invoice: Invoice, action: InvoiceAction) -> tuple[bool, str | None]:
    """
    Validate an invoice state transition. Returns (allowed, error_message).
    """
    if action == InvoiceAction.ISSUE:
        return _can_issue_invoice(invoice)
    elif action == InvoiceAction.CANCEL:
        return _can_cancel_invoice(invoice)
    elif action == InvoiceAction.RECORD_PAYMENT:
        return invoice.status == "issued", "Payments only allowed on issued invoices"
    elif action == InvoiceAction.DUPLICATE:
        return True, None
    elif action == InvoiceAction.DELETE:
        return invoice.status == "draft", "Only draft invoices can be deleted"
    return False, f"Unknown action: {action}"