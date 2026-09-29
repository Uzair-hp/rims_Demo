"""
Ruchita Interiors — dashboard service (§9.2, §11, §23).

The whole point of this module is that the dashboard is **derived**, not stored.
There is no `dashboard` table and no cached rollup, so the numbers cannot drift
from the documents they summarise. Recomputing on every read is cheap here
precisely because every figure is an indexable aggregate over four small tables.

Two rules do most of the work, and both are imported rather than re-implemented:

- **`BILLED_STATUS`** (`services/invoices.py`) is the single definition of "this
  invoice counts toward money". A draft has not been billed and a cancelled one
  never will be, so both are excluded from invoiced and outstanding. Declaring
  `'issued'` here instead would be how the dashboard and the invoice page end up
  disagreeing about the same money.
- **`_paid_paise_expr()`** (`services/invoices.py`) is the same correlated
  subquery the invoice list filter uses. Reusing it means "received" and the
  `payment_status` badge are computed by one expression, not two.

**Everything aggregates in SQL.** `services/clients.py` sums `paid_paise` in
Python over already-loaded rows, which is right for one client's handful of
invoices and wrong for a dashboard: at Phase 9's exit gate ("numbers match a
hand-computed scenario") this must be a `SUM()`/`GROUP BY`, or loading every row
to add it in Python would break §5's response-time budget as soon as the
database holds a few thousand records.

**Money is paise everywhere**, integer, matching §11 and every other service.
Formatting for humans happens in the client.

Metric definitions, resolved once here so the test can assert them:

- `quotation_counts` — one row per quotation status, §8.3's five values.
- `quotation_values` — `SUM(grand_total_paise)` grouped by status. A quotation
  with a NULL grand total contributes 0 rather than nulling the group, so
  `COALESCE` is applied per row.
- `total_quotation_value` — **all quotations regardless of status** (§9.2 lists
  it beside the per-status values without qualifying it, so the total is
  literally the total: draft + sent + approved + rejected + converted). This is
  the pipeline's whole value, not just the approved slice, and it is asserted
  directly in `tests/test_dashboard.py` so the choice cannot drift silently.
- `invoiced_value` — `SUM(invoice.grand_total_paise)` over `BILLED_STATUS` only.
- `received_total` — `SUM(payments.amount_paise)` joined to invoices, filtered
  to `BILLED_STATUS`. §11: "only actual payment rows count toward received". The
  join matters even though cancel is blocked once a payment exists: it keeps the
  figure correct if that rule ever changes, and costs one predicate.
- `outstanding_total` — `invoiced_value − received_total`, computed once from
  the two figures above rather than re-summing, so the three can never disagree.
- `monthly` — exactly 12 buckets, oldest first, zero-filled. Quotation series
  group by `quotation_date`, invoiced by `issue_date`, received by `paid_on`.
  These are three different columns on three different tables and conflating any
  pair silently shifts a month.
- `daily` — the last 30 days at day granularity, same shape and same three
  columns, also zero-filled. **Additive**: `monthly` and every money total are
  unchanged, and the 12-month view stays the default. It exists because a
  7/14/30-day view cannot honestly be carved out of monthly buckets — a month is
  not a day — so the short ranges are measured rather than approximated. Being
  additive, it does not disturb §9.2's "one request, one query set": the client
  slices `daily` and never re-aggregates.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select

from app.extensions.database import db
from app.models import Client, Invoice, Payment, Quotation
from app.services.invoices import BILLED_STATUS, _paid_paise_expr

#: §8.3's quotation statuses, in pipeline order. Iterated explicitly rather than
#: read from the table so the response always carries every key — a status with
#: no rows must still be present as 0, or the UI has to guard every read.
QUOTATION_STATUSES = ("draft", "sent", "approved", "rejected", "converted")

#: FR-D2 caps each recent list at five.
RECENT_LIMIT = 5

#: §9.2 asks for 12 months: the current month plus the eleven before it.
MONTH_BUCKETS = 12

#: Day-level buckets for the Dashboard's 7/14/30-day view. Additive: `monthly` is
#: unchanged and remains the 12-month default.
DAILY_BUCKETS = 30


def _month_keys(today: date | None = None) -> list[str]:
    """
    The 12 `YYYY-MM` keys the series must contain, oldest first.

    Built in Python rather than left to SQLite's `strftime`, so the buckets are
    exact and zero-filled regardless of what the data happens to contain. A
    `GROUP BY strftime(...)` on an empty table returns no rows at all, and a
    series with nine buckets silently misaligns against a chart expecting twelve.
    """
    today = today or date.today()
    keys: list[str] = []
    year, month = today.year, today.month
    for _ in range(MONTH_BUCKETS):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return list(reversed(keys))


def _month_expression(column):
    """`YYYY-MM` for a DATE column, in SQL. Matches `_month_keys()`' format."""
    return func.strftime("%Y-%m", column)


def _day_expression(column):
    """`YYYY-MM-DD` for a DATE column, in SQL. Matches `_day_keys()`' format."""
    return func.strftime("%Y-%m-%d", column)


def _day_keys(today: date | None = None) -> list[str]:
    """
    The last `DAILY_BUCKETS` `YYYY-MM-DD` keys, oldest first.

    Built in Python for the same reason as `_month_keys()`: the bucket list is
    fixed regardless of what data exists, so a sparse or empty period still
    yields exactly the requested number of points. A `GROUP BY` over days would
    return nothing for a quiet week and the chart would silently collapse.
    """
    today = today or date.today()
    return [(today - timedelta(days=offset)).isoformat() for offset in range(DAILY_BUCKETS - 1, -1, -1)]


def _quotation_counts() -> dict[str, int]:
    rows = db.session.execute(
        select(Quotation.status, func.count(Quotation.id)).group_by(Quotation.status)
    ).all()
    found = {status: int(count) for status, count in rows}
    return {status: found.get(status, 0) for status in QUOTATION_STATUSES}


def _quotation_values() -> dict[str, int]:
    """
    Grand totals grouped by status, plus the all-status total.

    `total_quotation_value` is a separate `SUM` over the whole table rather than
    the sum of the per-status groups, so it is correct even if a row ever carries
    a status outside the five (a CHECK constraint prevents that today, but the
    two can then never disagree).
    """
    rows = db.session.execute(
        select(
            Quotation.status,
            func.coalesce(func.sum(Quotation.grand_total_paise), 0),
        ).group_by(Quotation.status)
    ).all()
    per_status = {status: int(total) for status, total in rows}

    values = {f"{status}_value": per_status.get(status, 0) for status in QUOTATION_STATUSES}
    values["total_quotation_value"] = int(
        db.session.scalar(
            select(func.coalesce(func.sum(Quotation.grand_total_paise), 0)).select_from(Quotation)
        )
        or 0
    )
    return values


def _money_figures() -> dict[str, int]:
    """
    Invoiced, received and outstanding — the three figures §9.2 names.

    Both sums are scoped to `BILLED_STATUS`, so drafts and cancelled invoices
    cannot reach the totals (§11). Received is aggregated by joining payments to
    their invoice rather than summing the payments table on its own.
    """
    invoiced = int(
        db.session.scalar(
            select(func.coalesce(func.sum(Invoice.grand_total_paise), 0)).where(
                Invoice.status == BILLED_STATUS
            )
        )
        or 0
    )

    received = int(
        db.session.scalar(
            select(func.coalesce(func.sum(Payment.amount_paise), 0))
            .select_from(Payment)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(Invoice.status == BILLED_STATUS)
        )
        or 0
    )

    # Derived once, from the two figures above. Recomputing outstanding as its own
    # independent sum is how "outstanding" starts disagreeing with
    # "invoiced − received" on a page that shows all three.
    return {
        "invoiced_value": invoiced,
        "received_total": received,
        "outstanding_total": invoiced - received,
    }


def _monthly_series(today: date | None = None) -> list[dict]:
    """
    Exactly 12 chronological buckets, zero-filled, oldest first.

    Three grouped queries, then a Python merge onto the known key list. Each
    series uses its own date column — `quotation_date` for quotations,
    `issue_date` for invoiced, `paid_on` for received — because they are different
    columns on different tables and a payment in month N against an invoice issued
    in month N−1 must land in month N.

    `issue_date` is nullable, so invoices that have not been issued are skipped by
    the `BILLED_STATUS` filter; the `IS NOT NULL` guard keeps a stray NULL from
    producing a bucket keyed on the empty string.
    """
    keys = _month_keys(today)
    start = date(int(keys[0][:4]), int(keys[0][5:7]), 1)

    # The quotation query returns three columns, so the mapping is built by
    # unpacking rather than by `dict(rows)` (which needs pairs).
    quotation_rows = {
        month: (count, value)
        for month, count, value in db.session.execute(
            select(
                _month_expression(Quotation.quotation_date),
                func.count(Quotation.id),
                func.coalesce(func.sum(Quotation.grand_total_paise), 0),
            )
            .where(Quotation.quotation_date >= start)
            .group_by(_month_expression(Quotation.quotation_date))
        ).all()
    }

    invoiced_rows = dict(
        db.session.execute(
            select(
                _month_expression(Invoice.issue_date),
                func.coalesce(func.sum(Invoice.grand_total_paise), 0),
            )
            .where(Invoice.status == BILLED_STATUS, Invoice.issue_date.isnot(None), Invoice.issue_date >= start)
            .group_by(_month_expression(Invoice.issue_date))
        ).all()
    )

    received_rows = dict(
        db.session.execute(
            select(
                _month_expression(Payment.paid_on),
                func.coalesce(func.sum(Payment.amount_paise), 0),
            )
            .select_from(Payment)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(Invoice.status == BILLED_STATUS, Payment.paid_on >= start)
            .group_by(_month_expression(Payment.paid_on))
        ).all()
    )

    series = []
    for key in keys:
        count, quotation_value = quotation_rows.get(key, (0, 0))
        series.append(
            {
                "month": key,
                "quotation_count": int(count),
                "quotation_value": int(quotation_value or 0),
                "invoiced_value": int(invoiced_rows.get(key, 0) or 0),
                "received_value": int(received_rows.get(key, 0) or 0),
            }
        )
    return series


def _daily_series(today: date | None = None) -> list[dict]:
    """
    The last 30 days, one bucket per day, zero-filled, oldest first.

    This is **additive**: `monthly` and every money total are untouched, and the
    12-month view remains the Dashboard's default. It exists because a 7/14/30-day
    view cannot be derived from monthly buckets — a month is not a day, and
    slicing a 30-day figure out of a month total would be an approximation, not a
    measurement. Each bucket is a real `GROUP BY` on a real column, so the
    short-range figures reconcile with the monthly ones instead of contradicting
    them.

    Same three date columns as the monthly series, at day granularity:
    `quotation_date` for quotations, `issue_date` for invoiced, `paid_on` for
    received. `issue_date` is nullable, so invoices with no issue date are
    skipped and cannot create a bucket keyed on the empty string.
    """
    keys = _day_keys(today)
    start = date.fromisoformat(keys[0])

    quotation_rows = {
        day: (count, value)
        for day, count, value in db.session.execute(
            select(
                _day_expression(Quotation.quotation_date),
                func.count(Quotation.id),
                func.coalesce(func.sum(Quotation.grand_total_paise), 0),
            )
            .where(Quotation.quotation_date >= start)
            .group_by(_day_expression(Quotation.quotation_date))
        ).all()
    }

    invoiced_rows = dict(
        db.session.execute(
            select(
                _day_expression(Invoice.issue_date),
                func.coalesce(func.sum(Invoice.grand_total_paise), 0),
            )
            .where(
                Invoice.status == BILLED_STATUS,
                Invoice.issue_date.isnot(None),
                Invoice.issue_date >= start,
            )
            .group_by(_day_expression(Invoice.issue_date))
        ).all()
    )

    received_rows = dict(
        db.session.execute(
            select(
                _day_expression(Payment.paid_on),
                func.coalesce(func.sum(Payment.amount_paise), 0),
            )
            .select_from(Payment)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(Invoice.status == BILLED_STATUS, Payment.paid_on >= start)
            .group_by(_day_expression(Payment.paid_on))
        ).all()
    )

    series = []
    for key in keys:
        count, quotation_value = quotation_rows.get(key, (0, 0))
        series.append(
            {
                "date": key,
                "quotation_count": int(count),
                "quotation_value": int(quotation_value or 0),
                "invoiced_value": int(invoiced_rows.get(key, 0) or 0),
                "received_value": int(received_rows.get(key, 0) or 0),
            }
        )
    return series


def _recent_quotations() -> list[dict]:
    """
    Columns are selected explicitly rather than loading whole ORM entities.

    The dashboard needs five fields per row and nothing else, and selecting them
    by name keeps the returned mapping unambiguous (a `select(Quotation,
    Client.name)` row is not keyed by attribute).
    """
    rows = db.session.execute(
        select(
            Quotation.id,
            Quotation.number,
            Client.name.label("client_name"),
            Quotation.status,
            Quotation.grand_total_paise,
            Quotation.quotation_date,
        )
        .join(Client, Client.id == Quotation.client_id)
        .order_by(Quotation.created_at.desc(), Quotation.id.desc())
        .limit(RECENT_LIMIT)
    ).all()
    return [
        {
            "id": row.id,
            "number": row.number,
            "client_name": row.client_name,
            "status": row.status,
            "grand_total_paise": row.grand_total_paise or 0,
            "date": row.quotation_date.isoformat() if row.quotation_date else None,
        }
        for row in rows
    ]


def _recent_invoices() -> list[dict]:
    """
    Recent invoices with their derived paid/outstanding figures.

    `paid_paise` comes from the same `_paid_paise_expr()` the list filter uses, so
    a recent row cannot disagree with the same invoice's detail page. The status
    string is derived by `payment_status()` rather than reimplemented.
    """
    from app.services.invoices import payment_status

    rows = db.session.execute(
        select(
            Invoice.id,
            Invoice.number,
            Client.name.label("client_name"),
            Invoice.status,
            Invoice.grand_total_paise,
            Invoice.issue_date,
            _paid_paise_expr().label("paid_paise"),
        )
        .join(Client, Client.id == Invoice.client_id)
        .order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .limit(RECENT_LIMIT)
    ).all()

    recent = []
    for row in rows:
        grand = row.grand_total_paise or 0
        paid = int(row.paid_paise or 0)
        recent.append(
            {
                "id": row.id,
                "number": row.number,
                "client_name": row.client_name,
                "status": row.status,
                "grand_total_paise": grand,
                "paid_paise": paid,
                "outstanding_paise": grand - paid,
                "payment_status": payment_status(paid, grand),
                "date": row.issue_date.isoformat() if row.issue_date else None,
            }
        )
    return recent


def _recent_clients() -> list[dict]:
    """
    Recent clients, archived ones excluded (FR-C4).

    An archived client still owns its quotation history, so the invoices and
    quotations lists keep showing them; this list is a "who is active" shortcut,
    and an archived client is not one.
    """
    rows = db.session.execute(
        select(Client.id, Client.name, Client.phone, Client.created_at)
        .where(Client.archived_at.is_(None))
        .order_by(Client.created_at.desc(), Client.id.desc())
        .limit(RECENT_LIMIT)
    ).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "phone": row.phone,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def dashboard_summary(today: date | None = None) -> dict:
    """
    The whole Dashboard, in one dict — §9.2's "one request, one query set".

    Grouped into the shapes the page renders: quotation counts, quotation values,
    the money trio, the two time series, and the recent lists. Every figure is
    paise except counts and the date keys.
    """
    return {
        "quotation_counts": _quotation_counts(),
        "quotation_values": _quotation_values(),
        "money": _money_figures(),
        "monthly": _monthly_series(today),
        "daily": _daily_series(today),
        "recent": {
            "quotations": _recent_quotations(),
            "invoices": _recent_invoices(),
            "clients": _recent_clients(),
        },
    }


__all__ = [
    "DAILY_BUCKETS",
    "MONTH_BUCKETS",
    "QUOTATION_STATUSES",
    "RECENT_LIMIT",
    "dashboard_summary",
]
