"""
Ruchita Interiors — invoices service (§9.2, §11, §13.2, §8.4).

Business rules for invoices, kept out of the blueprint (§23: routes parse,
validate, call one function here and respond). Phase 3 created the tables and
Phase 5 wrote the conversion endpoint inline; this module gives both a proper
home and adds everything Phase 7 needs around them.

Four ideas shape it:

- **Paid and outstanding are computed, never stored** (§11). `payment_status()` and
  `paid_paise_for()` live here, and `clients.py` imports them rather than keeping a
  second copy — two implementations of "is this invoice paid" is how a client
  summary and an invoice page start disagreeing.
- **Payment status is filtered in SQL, not in Python.** `payment_status` is not a
  column, so `GET /invoices?payment_status=partially_paid` has to be expressed
  against the payments aggregate. `payment_status_predicate()` builds the same
  three-way comparison `payment_status()` does, as a correlated subquery, so the
  filter and the badge can never disagree.
- **The invoice is a snapshot** (§8.4). Client, items, totals, terms, bank details
  and signatory are copied at conversion and never re-read from Settings. Editing
  Settings afterwards must not change an issued invoice, and there is a test for it.
- **Issue locks, cancel releases** (§13.2). Issuing is the point of no return for
  the money; cancelling is blocked once a payment exists and hands the quotation
  back to `approved` so the same work can be re-invoiced.

Payment *management* (recording, editing, deleting payments) is Phase 8 and is
deliberately absent here. This module only reads the `payments` table, which is
what the status and outstanding figures require.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select

from app.extensions.database import db
from app.models import Client, Invoice, InvoiceItem, Payment
from app.models.quotation import Quotation
from app.utils.errors import business_rule, conflict, not_found

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

#: Only issued, non-cancelled invoices count toward money metrics (§11). A draft
#: has not been billed yet and a cancelled one never will be.
BILLED_STATUS = "issued"


# --------------------------------------------------------------------------
# Payment arithmetic — the single definition (§11)
# --------------------------------------------------------------------------


def payment_status(paid_paise: int, grand_total_paise: int) -> str:
    """
    The §11 payment status, computed from the ledger — never stored as truth.

    Lives here rather than in `clients.py` because the client summary and the
    invoice surfaces must produce the same answer from one definition.
    """
    if paid_paise <= 0:
        return "unpaid"
    if paid_paise >= grand_total_paise:
        return "paid"
    return "partially_paid"


def paid_paise_for(invoice_id: int) -> int:
    """Σ payments for one invoice, in paise. 0 when there are none."""
    return (
        db.session.scalar(
            select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
                Payment.invoice_id == invoice_id
            )
        )
        or 0
    )


def _paid_paise_expr():
    """
    Correlated subquery for "Σ payments of the invoice on the left-hand side".

    Lets the payment-status filter run in the database instead of loading every
    invoice and filtering in Python, which would break §5's pagination and
    response-time budget as soon as there are more than a page of invoices.
    """
    return (
        select(func.coalesce(func.sum(Payment.amount_paise), 0))
        .where(Payment.invoice_id == Invoice.id)
        .correlate(Invoice)
        .scalar_subquery()
    )


def payment_status_predicate(status: str):
    """
    SQL form of `payment_status()`, for the list filter.

    Mirrors the Python comparison exactly:
        unpaid          -> paid <= 0
        paid            -> paid > 0 and paid >= grand total
        partially_paid  -> paid > 0 and paid <  grand total
    """
    paid = _paid_paise_expr()
    grand = func.coalesce(Invoice.grand_total_paise, 0)

    if status == "unpaid":
        return paid <= 0
    if status == "paid":
        return (paid > 0) & (paid >= grand)
    if status == "partially_paid":
        return (paid > 0) & (paid < grand)
    raise ValueError(f"Unsupported payment_status filter: {status!r}")


# --------------------------------------------------------------------------
# Serialisation
# --------------------------------------------------------------------------


def serialize_invoice(invoice: Invoice) -> dict:
    """
    Full invoice document for the API.

    `InvoiceSchema` supplies the stored fields; the four §11 figures and the
    lifecycle actions are computed here, because they are derived state with no
    column behind them. `allowed_actions` comes from the lifecycle service so the
    UI renders exactly what the server permits (D11).
    """
    from app.schemas.quotations import invoice_schema
    from app.services.lifecycle import get_invoice_allowed_actions

    data = invoice_schema.dump(invoice)

    grand_total = invoice.grand_total_paise or 0
    paid = paid_paise_for(invoice.id)

    data["grand_total_paise"] = grand_total
    data["paid_paise"] = paid
    data["outstanding_paise"] = grand_total - paid
    data["payment_status"] = payment_status(paid, grand_total)
    # How the client actually paid most recently — the *ledger's* method, for
    # application/status display only. This is deliberately NOT the invoice's
    # `payment_method` (b8d5f0e2c7a1), which is the presentation choice frozen at
    # issue. The two are allowed to disagree, and it is the reason this read
    # exists separately: a derived value that no row is written from cannot make an
    # issued invoice a different document (§8.4). DocumentPaper must not consult
    # it — the printed payment block reads `payment_method` and the settings.
    data["latest_payment_method"] = db.session.scalar(
        select(Payment.method)
        .where(Payment.invoice_id == invoice.id)
        .order_by(Payment.paid_on.desc(), Payment.id.desc())
        .limit(1)
    )
    data["allowed_actions"] = get_invoice_allowed_actions(invoice).to_list()
    return data


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------


def get_invoice(invoice_id: int) -> Invoice:
    invoice = db.session.get(Invoice, invoice_id)
    if invoice is None:
        raise not_found("Invoice not found.")
    return invoice


# ------------------------------------------------------- payment due document


def payment_due_document(invoice: Invoice) -> dict:
    """
    Build the Balance / Payment Due document for an invoice (§8.5).

    **This writes nothing.** It is a read of the invoice and its payment ledger, so
    generating one cannot create revenue, duplicate a payment, or leave a stored
    balance to go stale. Every figure is re-derived on each call, which is exactly why
    a previously printed copy needs no updating: it was a snapshot, and the next one
    reflects whatever the ledger says now.

    Deliberately **not** a new `Invoice` row. `services/dashboard.py` sums
    `SUM(invoice.grand_total_paise)` over issued invoices, and `clients.py` does the
    same for a client summary, so a persisted "balance invoice" would add a second
    ₹60,000 to revenue. The original invoice stays the only billing document and the
    ledger stays the only record of money received.

    Nor does it get its own document number. `numbering.py` allocates per
    `(doc_type, year)` and would need a new counter to carry a `PD-` prefix, but a
    second number on a collection notice reads as a second sale - the confusion this
    document exists to avoid. It is referenced by the invoice number it is about,
    which is the only identity it needs.

    The amount due is `grand_total_paise - Σ payments` (§11), the same arithmetic
    `payment_status` uses, so the figure on the paper and the badge on the invoice
    list are produced by one calculation. Amounts stay integer paise end to end; the
    client formats them, so no float ever touches money.

    `upi_uri` is built here rather than in the browser so the QR cannot encode a
    different amount from the one this function reports, and so a non-positive
    balance yields `None` (no QR) instead of a code that opens a payment app asking
    for ₹0. Scanning it initiates a payment and nothing more: recording one is still
    the Record Payment flow, and no status changes as a result of reading this.
    """
    from app.models.company_settings import CompanySettings
    from app.services.calculations import format_upi_amount, build_upi_uri
    from app.services.lifecycle import InvoiceAction, validate_invoice_transition

    # A demand notice is only meaningful for an issued invoice. Drafts have not been
    # billed, and a cancelled one must never produce a demand for money.
    allowed, reason = validate_invoice_transition(invoice, InvoiceAction.RECORD_PAYMENT)
    if not allowed:
        raise business_rule(reason or "A payment due document can only be issued for an issued invoice.")

    grand_total = invoice.grand_total_paise or 0
    paid = paid_paise_for(invoice.id)
    outstanding = max(0, grand_total - paid)

    # Which method actually collected money most recently, so the reminder states how
    # the customer has been paying. Same derived read as `serialize_invoice` uses for
    # the invoice's payment line, and from the same source.
    latest = db.session.scalar(
        select(Payment.method)
        .where(Payment.invoice_id == invoice.id)
        .order_by(Payment.paid_on.desc(), Payment.id.desc())
        .limit(1)
    )

    # A fully settled invoice has nothing to collect, so there is no document to
    # produce. Refusing here (rather than returning an empty one) means the client
    # cannot render a ₹0 QR by ignoring the flag.
    if outstanding <= 0:
        raise business_rule(
            f"Invoice {invoice.number} is fully paid, so there is no outstanding balance."
        )

    settings = CompanySettings.get_row()
    upi_id = (settings.upi_id or "").strip()
    payee = (settings.company_name or "").strip()

    return {
        "kind": "payment_due",
        "title": "PAYMENT DUE",
        # The original invoice is the only billing document; this one is a
        # collection notice about it.
        "source_invoice_id": invoice.id,
        "source_invoice_number": invoice.number,
        "generated_on": date.today().isoformat(),
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "currency": "INR",
        "grand_total_paise": grand_total,
        "paid_paise": paid,
        "outstanding_paise": outstanding,
        "amount_due_paise": outstanding,
        "payment_status": payment_status(paid, grand_total),
        "latest_payment_method": latest,
        # Live from Settings, never snapshotted: a payee that closes the account must
        # not leave a printed notice directing money at it. This mirrors the §8.4
        # exception already made for the payment QR.
        "upi_id": upi_id,
        "payee_name": payee,
        "upi_uri": build_upi_uri(vpa=upi_id, payee_name=payee, amount_paise=outstanding, note=invoice.number),
        "upi_amount": format_upi_amount(outstanding),
        "bank": {
            "account_name": settings.bank_account_name,
            "account_number": settings.bank_account_number,
            "bank_name": settings.bank_name,
            "ifsc": settings.bank_ifsc,
            "branch": settings.bank_branch,
            "upi_id": upi_id,
        },
        "client": invoice.client_snapshot or {},
    }


def list_invoices(
    *,
    q: str | None = None,
    payment_status: str | None = None,
    client_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = "created_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Invoice], int]:
    """
    Return `(items, total)` for the invoices list.

    `q` matches the invoice number or the client name, like the quotations list,
    so one search box works across both document types. Draft and cancelled
    invoices stay in the list (§8.4 keeps history); the payment-status filter is
    about money, and applies to whatever is on the page.
    """
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    statement = Invoice.query

    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        statement = statement.join(Client, Invoice.client_id == Client.id).filter(
            or_(
                Invoice.number.ilike(like, escape="\\"),
                Client.name.ilike(like, escape="\\"),
            )
        )

    if payment_status:
        statement = statement.where(payment_status_predicate(payment_status))

    if client_id:
        statement = statement.where(Invoice.client_id == client_id)

    if date_from:
        statement = statement.where(Invoice.issue_date >= date_from)
    if date_to:
        statement = statement.where(Invoice.issue_date <= date_to)

    sort_col = getattr(Invoice, sort, Invoice.created_at)
    query = statement.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

    pagination = query.paginate(page=page, per_page=page_size, error_out=False)
    return pagination.items, pagination.total


# --------------------------------------------------------------------------
# Mutations
# --------------------------------------------------------------------------


def update_invoice_draft(invoice: Invoice, payload: dict) -> Invoice:
    """
    Edit the Draft fields only (§9.2): dates, notes, terms.

    Items lock at Issue (FR-I3, D7) and the financial fields are a snapshot of an
    approved quotation — none of them are writable here, deliberately.
    """
    if invoice.status != "draft":
        raise business_rule("Only draft invoices can be edited.")

    # `payment_method` is in this list and nowhere else: the draft-only guard above
    # is the whole of the "frozen at issue" guarantee, so there is no second lock
    # and no ledger path that can reach it. See migration b8d5f0e2c7a1.
    for field in ("issue_date", "due_date", "notes", "terms_text", "payment_method"):
        if field in payload:
            setattr(invoice, field, payload[field])

    db.session.commit()
    return invoice


def issue_invoice(invoice: Invoice) -> Invoice:
    """
    Draft -> issued. The point at which the money is real.

    `validate_invoice_transition` carries the guards (at least one valid line, a
    positive grand total). Issuing is irreversible except by cancelling, which is
    why the UI confirms first (FR-U1).
    """
    from app.services.lifecycle import InvoiceAction, validate_invoice_transition

    allowed, reason = validate_invoice_transition(invoice, InvoiceAction.ISSUE)
    if not allowed:
        raise business_rule(reason or "That invoice cannot be issued right now.")

    invoice.status = "issued"
    db.session.commit()
    return invoice


def cancel_invoice(invoice: Invoice) -> Invoice:
    """
    Cancel, and release the quotation back to `approved` (§13.2).

    Two things happen in one transaction:

    - the invoice is marked `cancelled`, which frees the partial unique index
      `uq_invoices_active_quotation`, so the quotation can be invoiced again;
    - the parent quotation goes back to `approved`, so `create_invoice` is
      permitted again by the lifecycle state machine rather than being special-
      cased here.

    Cancelling is refused while any payment exists — money has been taken against
    this invoice, and the fix is a payment correction (Phase 8), not a cancel.
    """
    from app.services.lifecycle import InvoiceAction, validate_invoice_transition

    allowed, reason = validate_invoice_transition(invoice, InvoiceAction.CANCEL)
    if not allowed:
        raise business_rule(reason or "That invoice cannot be cancelled right now.")

    invoice.status = "cancelled"

    if invoice.quotation_id:
        quotation = db.session.get(Quotation, invoice.quotation_id)
        # Only release a quotation this invoice actually converted. A quotation
        # that has since moved on (impossible while an invoice is active, but the
        # check costs nothing) is left alone rather than dragged backwards.
        if quotation is not None and quotation.status == "converted":
            quotation.status = "approved"

    db.session.commit()
    return invoice


# --------------------------------------------------------------------------
# Conversion (§8.4, §11)
# --------------------------------------------------------------------------


class ConversionSafetyError(RuntimeError):
    """
    The invoice totals do not match the quotation they were copied from.

    Deliberately a plain `RuntimeError`: the app's global handler turns it into
    `500 INTERNAL` with a generic message and a logged error id (§16), which is
    the right response for "the stored data disagrees with itself" — this is a
    bug, not a user error, and the user cannot act on it.
    """


def convert_quotation(quotation: Quotation, *, created_by: int | None = None) -> Invoice:
    """
    Convert an approved quotation into a Draft invoice, in one transaction.

    Order of guards matters, and is the reason this moved out of the blueprint.
    The "an invoice already exists" check runs **before** the status check: after a
    successful conversion the quotation is `converted`, so checking status first
    would answer every second attempt with a bare 422 and the 409 carrying the
    existing invoice id — the one response that lets the UI offer "View invoice"
    (§9.2, §25) — would be unreachable.

    The totals are recomputed from the copied items and compared against the
    quotation's stored figures. A locked approved quotation cannot legitimately
    disagree with itself, so a mismatch means the data is corrupt; §11 calls for
    aborting the whole conversion rather than storing an invoice whose money does
    not add up. Nothing is committed before that check, so the invoice, its items
    and the allocated number all roll back together (§8.4: one transaction).
    """
    from app.models.company_settings import CompanySettings
    from app.services.calculations import calculate_line_total, calculate_totals
    from app.services.numbering import allocate_number

    existing = Invoice.query.filter(
        Invoice.quotation_id == quotation.id,
        Invoice.status != "cancelled",
    ).first()
    if existing is not None:
        raise conflict(
            "An invoice already exists for this quotation.",
            [{"invoice_id": existing.id, "invoice_number": existing.number}],
        )

    if quotation.status != "approved":
        raise business_rule("Only approved quotations can be converted to an invoice.")

    # Safety assert (§11): recompute independently from the items being copied,
    # not from the totals being copied.
    recomputed = calculate_totals(
        line_totals=[
            calculate_line_total(item.qty_milli, item.rate_paise).line_total_paise
            for item in quotation.items
        ],
        discount_type=quotation.discount_type,
        discount_bp=quotation.discount_bp,
        discount_fixed_paise=quotation.discount_fixed_paise,
        gst_bp=quotation.gst_bp or 0,
        other_charges_paise=quotation.other_charges_paise or 0,
    )
    expected = (
        quotation.subtotal_paise or 0,
        quotation.discount_paise or 0,
        quotation.gst_paise or 0,
        quotation.grand_total_paise or 0,
    )
    actual = (
        recomputed.subtotal_paise,
        recomputed.discount_paise,
        recomputed.gst_paise,
        recomputed.grand_total_paise,
    )
    if actual != expected:
        raise ConversionSafetyError(
            "Conversion aborted: invoice totals recomputed from the quotation items "
            f"({actual}) do not match the stored quotation totals ({expected})."
        )

    allocation = allocate_number("invoice")
    settings = CompanySettings.get_or_create()

    invoice = Invoice(
        number=allocation.number,
        year=allocation.year,
        quotation_id=quotation.id,
        client_id=quotation.client_id,
        client_snapshot=quotation.client_snapshot,
        issue_date=date.today(),
        # No default due term exists: §8.3 gives invoices a due_date but
        # company_settings no due-days column, and inventing one would contradict
        # the schema. It stays nullable and is editable while the invoice is Draft.
        due_date=None,
        status="draft",
        discount_type=quotation.discount_type,
        discount_bp=quotation.discount_bp,
        discount_fixed_paise=quotation.discount_fixed_paise,
        gst_bp=quotation.gst_bp,
        other_charges_label=quotation.other_charges_label,
        other_charges_paise=quotation.other_charges_paise,
        subtotal_paise=quotation.subtotal_paise,
        discount_paise=quotation.discount_paise,
        gst_paise=quotation.gst_paise,
        grand_total_paise=quotation.grand_total_paise,
        terms_text=quotation.terms_text,
        # Bank details and signatory are snapshotted here (§8.4): editing Settings
        # afterwards must never rewrite an invoice that has already been issued.
        bank_snapshot={
            "account_name": settings.bank_account_name,
            "account_number": settings.bank_account_number,
            "bank_name": settings.bank_name,
            "ifsc": settings.bank_ifsc,
            "branch": settings.bank_branch,
            "upi_id": settings.upi_id,
        },
        signatory_name=settings.signatory_name,
        notes=quotation.notes,
        # The converting user, not the quotation's author: converting is its own
        # action and the invoice is the artefact of whoever pressed the button.
        created_by=created_by,
    )

    for item in quotation.items:
        invoice.items.append(
            InvoiceItem(
                category=item.category,
                name=item.name,
                description=item.description,
                unit=item.unit,
                qty_milli=item.qty_milli,
                rate_paise=item.rate_paise,
                line_total_paise=item.line_total_paise,
                position=item.position,
                # SERVICES_PLAN FR-SV8: conversion copies the catalog provenance
                # with everything else that is snapshotted (§8.4). Informational
                # only — no total depends on either field (S7).
                service_id=item.service_id,
                catalog_rate_paise=item.catalog_rate_paise,
            )
        )

    quotation.status = "converted"

    db.session.add(invoice)
    db.session.commit()
    return invoice
