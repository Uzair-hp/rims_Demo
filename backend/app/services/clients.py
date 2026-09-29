"""
Ruchita Interiors — clients service (§9.2, §4.2).

Business rules for the client book, kept out of the blueprint (§23: routes parse,
validate, call one function here and respond).

Three ideas shape this module:

- **Archive, never delete** (FR-C4, §27 D9). `DELETE /clients/:id` sets
  `archived_at`; there is no hard-delete endpoint, because quotations and invoices
  hold a `RESTRICT` FK to this table and history must survive.
- **Search is an escaped LIKE** (§16). `%` and `_` typed by the user are literals,
  not wildcards, so a client named "50% off" cannot become a match-everything
  query.
- **The summary reads the real tables** (FR-C3). Quotations, invoices and payments
  stay empty until Phases 5–8, so the lists come back empty and the totals compute
  to zero today without a special case — the same query starts returning data the
  moment those phases write rows.
"""

from __future__ import annotations

from sqlalchemy import func, or_, select

from app.extensions.database import db
from app.models import Client, Invoice, Payment, Quotation
from app.models.user import utcnow
from app.utils.errors import conflict, not_found

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

# Only issued, non-cancelled invoices count toward money metrics (§11). A draft
# has not been billed yet and a cancelled one never will be.
_BILLED_STATUS = "issued"


# ------------------------------------------------------------------- queries


def list_clients(
    *,
    q: str | None = None,
    include_archived: bool = False,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Client], int]:
    """
    Return `(items, total)` for the clients list.

    Default sort is `updated_at` desc (FR-C2): until documents exist there is no
    activity signal on a client, so "most recently touched first" is the honest
    ordering, and it is the same ordering the quotation picker wants.
    """
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    statement = select(Client)
    if not include_archived:
        statement = statement.where(Client.archived_at.is_(None))

    term = (q or "").strip()
    if term:
        pattern = f"%{_escape_like(term)}%"
        statement = statement.where(
            or_(
                Client.name.like(pattern, escape="\\"),
                Client.phone.like(pattern, escape="\\"),
                Client.email.like(pattern, escape="\\"),
            )
        )

    total = db.session.scalar(
        select(func.count()).select_from(statement.order_by(None).subquery())
    ) or 0

    rows = (
        db.session.scalars(
            statement.order_by(Client.updated_at.desc(), Client.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return list(rows), total


def get_client(client_id: int) -> Client:
    """
    Fetch one client — archived or not (FR-C4, §9.2).

    An archived client's detail URL must keep working, so history deep links never
    turn into a 404 just because the client left the address book.
    """
    client = db.session.get(Client, client_id)
    if client is None:
        raise not_found("That client could not be found.")
    return client


# ------------------------------------------------------------------ mutations


def create_client(payload: dict) -> Client:
    client = Client(**_editable_fields(payload))
    db.session.add(client)
    db.session.commit()
    return client


def update_client(client_id: int, payload: dict) -> Client:
    client = get_client(client_id)
    for field, value in _editable_fields(payload).items():
        setattr(client, field, value)
    db.session.commit()
    return client


def archive_client(client_id: int) -> Client:
    """
    Soft-delete (FR-C4). Idempotent: archiving an archived client is not an error,
    because the confirmation dialog can be re-submitted by an impatient double tap.
    """
    client = get_client(client_id)
    if client.archived_at is None:
        client.archived_at = utcnow()
        db.session.commit()
    return client


def restore_client(client_id: int) -> Client:
    """
    Clear the archive (FR-C4). A client that is already active is a 409 rather
    than a silent no-op: the Restore button is only rendered for archived clients,
    so a request against an active one means the page was stale.
    """
    client = get_client(client_id)
    if client.archived_at is None:
        raise conflict("That client is already active.")
    client.archived_at = None
    db.session.commit()
    return client


# ------------------------------------------------------------------- summary


def client_summary(client_id: int) -> dict:
    """
    Relationship history for one client (FR-C3, §9.2).

    Shape: `{ quotations, invoices, payments, totals: { billed, received,
    outstanding } }`, all money in paise. Quotations are listed newest first for
    the history tab; invoices carry their computed paid/outstanding so the strip
    and the tab agree.
    """
    client = get_client(client_id)

    quotations = _quotations_for(client.id)
    invoices = _invoices_for(client.id)
    payments = _payments_for(invoices)

    billed_paise = sum(invoice["grand_total_paise"] or 0 for invoice in invoices)
    received_paise = sum(payment["amount_paise"] or 0 for payment in payments)
    outstanding_paise = billed_paise - received_paise

    return {
        "client": client.to_dict(),
        "quotations": quotations,
        "invoices": invoices,
        "payments": payments,
        "totals": {
            "billed_paise": billed_paise,
            "received_paise": received_paise,
            "outstanding_paise": outstanding_paise,
        },
    }


def _quotations_for(client_id: int) -> list[dict]:
    rows = db.session.scalars(
        select(Quotation)
        .where(Quotation.client_id == client_id)
        .order_by(Quotation.quotation_date.desc(), Quotation.id.desc())
    ).all()
    return [
        {
            "id": row.id,
            "number": row.number,
            "status": row.status,
            "quotation_date": row.quotation_date.isoformat() if row.quotation_date else None,
            "valid_until": row.valid_until.isoformat() if row.valid_until else None,
            "grand_total_paise": row.grand_total_paise,
        }
        for row in rows
    ]


def _invoices_for(client_id: int) -> list[dict]:
    rows = db.session.scalars(
        select(Invoice)
        .where(Invoice.client_id == client_id, Invoice.status == _BILLED_STATUS)
        .order_by(Invoice.issue_date.desc(), Invoice.id.desc())
    ).all()

    result = []
    for row in rows:
        paid_paise = _paid_for(row.id)
        grand_total = row.grand_total_paise or 0
        result.append(
            {
                "id": row.id,
                "number": row.number,
                "status": row.status,
                "issue_date": row.issue_date.isoformat() if row.issue_date else None,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "grand_total_paise": grand_total,
                "paid_paise": paid_paise,
                "outstanding_paise": grand_total - paid_paise,
                "payment_status": payment_status(paid_paise, grand_total),
            }
        )
    return result


def _payments_for(invoices: list[dict]) -> list[dict]:
    """Payments across this client's invoices, newest first, named by invoice."""
    invoice_numbers = {invoice["id"]: invoice["number"] for invoice in invoices}
    if not invoice_numbers:
        return []

    rows = db.session.scalars(
        select(Payment)
        .where(Payment.invoice_id.in_(list(invoice_numbers.keys())))
        .order_by(Payment.paid_on.desc(), Payment.id.desc())
    ).all()
    return [
        {
            "id": row.id,
            "invoice_id": row.invoice_id,
            "invoice_number": invoice_numbers.get(row.invoice_id),
            "amount_paise": row.amount_paise,
            "paid_on": row.paid_on.isoformat() if row.paid_on else None,
            "method": row.method,
            "reference": row.reference,
        }
        for row in rows
    ]


def _paid_for(invoice_id: int) -> int:
    return db.session.scalar(
        select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
            Payment.invoice_id == invoice_id
        )
    ) or 0


def payment_status(paid_paise: int, grand_total_paise: int) -> str:
    """
    The §11 payment status, computed from the ledger — never stored.

    Phase 8 owns the payment endpoints; the definition lives here already because
    the client summary must show the same answer, and a second implementation is
    how two surfaces start disagreeing.
    """
    if paid_paise <= 0:
        return "unpaid"
    if paid_paise >= grand_total_paise:
        return "paid"
    return "partially_paid"


# ------------------------------------------------------------------- helpers


def _editable_fields(payload: dict) -> dict:
    return {
        "name": payload["name"],
        "phone": payload.get("phone"),
        "email": payload.get("email"),
        "address": payload.get("address"),
        "project_address": payload.get("project_address"),
        "gstin": payload.get("gstin"),
        "notes": payload.get("notes"),
    }


def _escape_like(value: str) -> str:
    """Escape LIKE metacharacters so a typed `%`/`_` is a literal (§16)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")