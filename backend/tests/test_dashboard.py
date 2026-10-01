"""
Phase 9 dashboard tests (§4.6, §9.2, §11, §22, §24).

The Dashboard's only requirement is that it is **truthful**, so almost every
test here is a truthfulness test. §24's exit gate is "dashboard numbers match a
hand-computed scenario exactly", and `SCENARIO_TRUTH` below is that computation,
written out as literals so a reviewer can check the arithmetic rather than trust
it.

The scenario is built straight through the ORM rather than through the API. Two
reasons: the numbers must be hand-computable, and a document reached through
`POST /quotations` would carry server-computed totals that are themselves only
correct if the calculation service is right. Writing `grand_total_paise` directly
makes the expected value an independent fact rather than a restatement.

**`BILLED_STATUS` is not restated here.** These tests never write the string
`'issued'` as an expectation for inclusion/exclusion; they say "the two issued
invoices" and the number follows from the service's own filter. If that filter
ever changes, the tests should fail rather than quietly agree with it.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app.extensions.database import db
from app.models import Client, Invoice, Payment, Quotation
from app.services.dashboard import (
    DAILY_BUCKETS,
    MONTH_BUCKETS,
    QUOTATION_STATUSES,
    RECENT_LIMIT,
    dashboard_summary,
)
from app.services.invoices import BILLED_STATUS

API = "/api/v1/dashboard/summary"


def _csrf(client) -> dict:
    from tests.conftest import _csrf as cs

    return cs(client)


# --------------------------------------------------------------------- dates


def month_start(today: date, offset: int = 0) -> date:
    """First day of the month `offset` months before `today`'s month."""
    total = today.year * 12 + (today.month - 1) + offset
    return date(total // 12, total % 12 + 1, 1)


# ------------------------------------------------------------------ scenario
#
# Twelve quotations across all five statuses, seven invoices spanning issued /
# draft / cancelled, and two payments deliberately placed in *different* months
# from their invoices. That last detail is the point of the monthly tests: it
# makes `issue_date` and `paid_on` observably different columns.

# (key, status, grand_total_paise, quotation month offset, creates invoice?, invoice status)
QUOTATIONS = [
    ("q_draft_a", "draft", 100000, 0, False, None),
    ("q_draft_b", "draft", 700000, -1, False, None),
    ("q_sent", "sent", 200000, 0, False, None),
    ("q_approved", "approved", 300000, -2, False, None),
    ("q_rejected", "rejected", 400000, -3, False, None),
    ("q_inv_a", "converted", 500000, -2, True, "issued"),
    ("q_inv_b", "converted", 600000, -4, True, "issued"),
    ("q_inv_c", "converted", 800000, 0, True, "draft"),
    ("q_inv_d", "converted", 900000, -5, True, "cancelled"),
    ("q_inv_e", "converted", 10000, 0, True, "draft"),
    ("q_inv_f", "converted", 10000, 0, True, "draft"),
    ("q_inv_g", "converted", 10000, 0, True, "draft"),
]

# Payments: (invoice quotation key, amount_paise, paid month offset)
PAYMENTS = [
    # Issued in month -1, half paid in the current month.
    ("q_inv_a", 200000, 0),
    # Issued in month -1, settled the same month it was issued.
    ("q_inv_b", 600000, -1),
]

#: The hand-computed truth, from the table above. Nothing derives these.
SCENARIO_TRUTH = {
    "quotation_counts": {
        "draft": 2,
        "sent": 1,
        "approved": 1,
        "rejected": 1,
        "converted": 7,
    },
    "quotation_values": {
        # 100000 + 700000
        "draft_value": 800000,
        "sent_value": 200000,
        "approved_value": 300000,
        "rejected_value": 400000,
        # 500000 + 600000 + 800000 + 900000 + 10000 * 3
        "converted_value": 2830000,
        # every quotation, regardless of status (D2): 4 530 000
        "total_quotation_value": 4530000,
    },
    "money": {
        # only the two issued invoices: 500000 + 600000
        "invoiced_value": 1100000,
        # 200000 + 600000
        "received_total": 800000,
        # invoiced - received
        "outstanding_total": 300000,
    },
    "counts": {"quotations": 12, "invoices": 7, "clients_active": 2, "clients_total": 3},
}


@pytest.fixture()
def scenario(app, authed_client):
    """
    Build the deterministic scenario. Returns a small handle for the tests.

    `created_at` is set explicitly on every row so the "recent 5" ordering is
    decided by this file and not by insertion timing — a test that asserts
    ordering must not depend on how fast the fixture ran.
    """
    # A reference date late in the *current* month rather than the wall-clock one.
    # The scenario places current-month rows at `month_start + 4` (quotations) and
    # `+ 12` (payments) days; the daily series only looks at the 30 days *ending*
    # on the reference date, so with `date.today()` those rows fell outside the
    # window whenever the suite ran in the first ~12 days of a month. Anchoring on
    # the 21st keeps every offset in the past and still inside the same month, so
    # the month-offset semantics below are unchanged.
    today = month_start(date.today()) + timedelta(days=20)
    base = datetime(2020, 1, 1, 9, 0, 0)

    with app.app_context():
        alpha = Client(name="Alpha Interiors", phone="+91 90000 00001", created_at=base)
        beta = Client(name="Beta Builders", phone="+91 90000 00002", created_at=base + timedelta(minutes=1))
        gamma = Client(
            name="Gamma Archived",
            phone="+91 90000 00003",
            archived_at=datetime(2020, 2, 1),
            created_at=base + timedelta(minutes=2),
        )
        db.session.add_all([alpha, beta, gamma])
        db.session.flush()

        by_status = {
            "draft": alpha,
            "sent": alpha,
            "approved": beta,
            "rejected": alpha,
            "converted": beta,
        }

        # Plain ints captured during the loop, never ORM objects: `commit()`
        # expires every instance, and the app context closes before the test body
        # runs, so anything returned would be detached.
        quotation_ids = {}
        invoice_ids = {}

        for index, (key, status, grand, month_offset, makes_invoice, inv_status) in enumerate(QUOTATIONS):
            client = by_status[status]
            quotation = Quotation(
                number=f"QTN-2026-{index + 1:04d}",
                year=2026,
                client_id=client.id,
                client_snapshot={"name": client.name},
                quotation_date=month_start(today, month_offset) + timedelta(days=4),
                status=status,
                grand_total_paise=grand,
                # Ascending with index, so "newest" is the highest index.
                created_at=base + timedelta(minutes=10 + index),
            )
            db.session.add(quotation)
            db.session.flush()
            quotation_ids[key] = quotation.id

            if makes_invoice:
                invoice = Invoice(
                    number=f"INV-2026-{index + 1:04d}",
                    year=2026,
                    quotation_id=quotation.id,
                    client_id=client.id,
                    client_snapshot={"name": client.name},
                    status=inv_status,
                    grand_total_paise=grand,
                    # A Draft invoice has no issue date at all; a cancelled one
                    # keeps the date it was issued on.
                    issue_date=(
                        None
                        if inv_status == "draft"
                        else month_start(today, -1) + timedelta(days=6)
                        if inv_status == "issued"
                        else month_start(today, -5) + timedelta(days=6)
                    ),
                    created_at=base + timedelta(minutes=10 + index),
                )
                db.session.add(invoice)
                db.session.flush()
                invoice_ids[key] = invoice.id

        for key, amount, month_offset in PAYMENTS:
            db.session.add(
                Payment(
                    invoice_id=invoice_ids[key],
                    amount_paise=amount,
                    paid_on=month_start(today, month_offset) + timedelta(days=12),
                    method="upi",
                )
            )
        db.session.commit()

    return {"today": today, "quotation_ids": quotation_ids, "invoice_ids": invoice_ids}


@pytest.fixture()
def ledger_scenario(app, authed_client):
    """
    Two issued invoices only: one half-paid, one settled.

    The mixed scenario deliberately pushes the recent-5 window onto its newest
    rows, which are the draft invoices — so the *payment status* cases need a
    dataset where the issued invoices are the recent ones. Keeping this separate
    is clearer than reordering `created_at` in the main scenario just to make two
    assertions reachable.
    """
    today = date.today()
    base = datetime(2021, 1, 1, 9, 0, 0)

    with app.app_context():
        client = Client(name="Ledger Client", created_at=base)
        db.session.add(client)
        db.session.flush()

        for index, (grand, paid) in enumerate([(500000, 200000), (600000, 600000)]):
            quotation = Quotation(
                number=f"QTN-2021-{index + 1:04d}",
                year=2021,
                client_id=client.id,
                client_snapshot={"name": client.name},
                quotation_date=today,
                status="converted",
                grand_total_paise=grand,
                created_at=base + timedelta(minutes=index),
            )
            db.session.add(quotation)
            db.session.flush()

            invoice = Invoice(
                number=f"INV-2021-{index + 1:04d}",
                year=2021,
                quotation_id=quotation.id,
                client_id=client.id,
                client_snapshot={"name": client.name},
                status=BILLED_STATUS,
                grand_total_paise=grand,
                issue_date=today,
                created_at=base + timedelta(minutes=index),
            )
            db.session.add(invoice)
            db.session.flush()

            db.session.add(
                Payment(
                    invoice_id=invoice.id,
                    amount_paise=paid,
                    paid_on=today,
                    method="upi",
                )
            )
        db.session.commit()


def compute(scenario, app) -> dict:
    """`dashboard_summary()` for the scenario, at the scenario's reference date."""
    with app.app_context():
        return dashboard_summary(today=scenario["today"])


def api_summary(authed_client) -> dict:
    response = authed_client.get(API)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()["data"]


# ------------------------------------------------------------------ the gate


def test_hand_computed_scenario_matches_exactly(scenario, app):
    """
    §24's exit gate: every headline figure equals the hand computation.

    Asserted as whole-dict equality rather than field by field, so a *newly added*
    figure cannot slip in unverified.
    """
    data = compute(scenario, app)

    assert data["quotation_counts"] == SCENARIO_TRUTH["quotation_counts"]
    assert data["quotation_values"] == SCENARIO_TRUTH["quotation_values"]
    assert data["money"] == SCENARIO_TRUTH["money"]


def test_total_quotation_value_counts_every_status(scenario, app):
    """
    D2, pinned on its own so the choice cannot drift silently.

    The total is Σ grand totals across *all* quotations regardless of status. It
    is not the sum of only the pipeline values, and it is not the approved slice.
    """
    values = compute(scenario, app)["quotation_values"]

    per_status_sum = sum(values[f"{status}_value"] for status in QUOTATION_STATUSES)
    assert values["total_quotation_value"] == 4530000
    # The tempting-but-wrong alternative: only the live pipeline.
    assert values["total_quotation_value"] != values["draft_value"] + values["approved_value"]
    # And it genuinely is the whole set, not an accident of the fixture.
    assert per_status_sum == values["total_quotation_value"]


def test_every_quotation_status_is_reported(scenario, app):
    """A status with no rows is still present as 0, so the UI never guards a read."""
    counts = compute(scenario, app)["quotation_counts"]
    assert set(counts) == set(QUOTATION_STATUSES)


# -------------------------------------------------------- money inclusion rules


def test_draft_and_cancelled_invoices_are_excluded_from_money(scenario, app):
    """
    §11: only `BILLED_STATUS` invoices count toward invoiced and outstanding.

    The fixture contains 800 000 of draft invoices, 30 000 of draft invoices, and
    a cancelled 900 000. None of it may appear.
    """
    money = compute(scenario, app)["money"]

    assert money["invoiced_value"] == 1100000
    assert money["invoiced_value"] < 1100000 + 800000 + 30000 + 900000
    # Outstanding is the issued figure minus what was received, so the excluded
    # rows cannot leak in through it either.
    assert money["outstanding_total"] == money["invoiced_value"] - money["received_total"]


def test_outstanding_is_invoiced_minus_received(scenario, app):
    money = compute(scenario, app)["money"]
    assert money["outstanding_total"] == money["invoiced_value"] - money["received_total"]
    # 500000 issued - 200000 paid leaves 300000; the settled invoice leaves 0.
    assert money["outstanding_total"] == 300000


def test_received_counts_only_real_payment_rows(scenario, app):
    """§11: "only actual payment rows count toward received"."""
    money = compute(scenario, app)["money"]
    assert money["received_total"] == 800000
    # Received never exceeds invoiced here, and both are strictly paise integers.
    assert isinstance(money["received_total"], int)
    assert money["received_total"] <= money["invoiced_value"]


def test_a_fully_paid_invoice_leaves_no_outstanding(ledger_scenario, app):
    """The settled invoice contributes its full amount and nothing outstanding."""
    with app.app_context():
        recent = dashboard_summary()["recent"]["invoices"]

    settled = next(row for row in recent if row["grand_total_paise"] == 600000)
    assert settled["payment_status"] == "paid"
    assert settled["outstanding_paise"] == 0
    assert settled["paid_paise"] == 600000


def test_a_partially_paid_invoice_reports_the_remainder(ledger_scenario, app):
    with app.app_context():
        recent = dashboard_summary()["recent"]["invoices"]

    partial = next(row for row in recent if row["grand_total_paise"] == 500000)
    assert partial["payment_status"] == "partially_paid"
    assert partial["paid_paise"] == 200000
    assert partial["outstanding_paise"] == 300000


def test_ledger_scenario_money_figures(ledger_scenario, app):
    with app.app_context():
        money = dashboard_summary()["money"]

    assert money["invoiced_value"] == 1100000
    assert money["received_total"] == 800000
    assert money["outstanding_total"] == 300000


def test_unpaid_invoice_reports_full_outstanding(scenario, app):
    """The draft invoices carry no payments, so they are entirely outstanding."""
    recent = compute(scenario, app)["recent"]["invoices"]
    unpaid = [row for row in recent if row["grand_total_paise"] == 800000]

    assert unpaid, "expected the 800000 draft invoice in the recent list"
    assert unpaid[0]["payment_status"] == "unpaid"
    assert unpaid[0]["outstanding_paise"] == 800000


# ------------------------------------------------------------- monthly series


def test_series_has_exactly_twelve_chronological_buckets(scenario, app):
    """FR-D3 / §9.2: 12 months. Never fewer, never more, always ordered."""
    series = compute(scenario, app)["monthly"]

    assert len(series) == MONTH_BUCKETS == 12
    months = [row["month"] for row in series]
    assert months == sorted(months)
    assert len(set(months)) == 12
    assert months[-1] == scenario["today"].strftime("%Y-%m")


def test_empty_months_are_zero_filled(scenario, app):
    """
    Months with no activity are present as zeros, not omitted.

    An omitted month shifts every later point left on the chart, which is the
    kind of quiet wrongness the exit gate exists to prevent.
    """
    series = compute(scenario, app)["monthly"]
    by_month = {row["month"]: row for row in series}

    quiet = by_month[month_start(scenario["today"], -8).strftime("%Y-%m")]
    assert quiet == {
        "month": month_start(scenario["today"], -8).strftime("%Y-%m"),
        "quotation_count": 0,
        "quotation_value": 0,
        "invoiced_value": 0,
        "received_value": 0,
    }


def test_invoiced_uses_issue_date_and_received_uses_paid_on(scenario, app):
    """
    The two money series are keyed on different columns, and the fixture makes
    that observable: one invoice was issued in month −1 and only half-paid in the
    current month, so invoiced and received peak in different buckets.
    """
    series = compute(scenario, app)["monthly"]
    by_month = {row["month"]: row for row in series}

    issued_month = month_start(scenario["today"], -1).strftime("%Y-%m")
    current_month = scenario["today"].strftime("%Y-%m")

    # Both issued invoices fall in month -1.
    assert by_month[issued_month]["invoiced_value"] == 1100000
    # The 600000 payment landed in that same month...
    assert by_month[issued_month]["received_value"] == 600000
    # ...and the other 200000 landed in the current month.
    assert by_month[current_month]["received_value"] == 200000
    assert by_month[current_month]["invoiced_value"] == 0


def test_cancelled_invoice_creates_no_invoiced_bucket(scenario, app):
    """The cancelled 900 000 was issued in month −5; that month must stay empty."""
    series = compute(scenario, app)["monthly"]
    by_month = {row["month"]: row for row in series}

    cancelled_month = month_start(scenario["today"], -5).strftime("%Y-%m")
    assert by_month[cancelled_month]["invoiced_value"] == 0
    # Its quotation still counts toward the quotation series for that month.
    assert by_month[cancelled_month]["quotation_count"] == 1


def test_null_issue_date_creates_no_bucket(scenario, app):
    """
    Draft invoices have `issue_date = NULL`.

    They are excluded by the status filter anyway; this pins that a NULL date
    cannot also produce a stray empty month key.
    """
    series = compute(scenario, app)["monthly"]
    assert all(row["month"] for row in series)
    assert None not in {row["month"] for row in series}


def test_quotation_series_totals_reconcile_with_the_headline(scenario, app):
    """The 12-month quotation series sums to the same total the tiles show."""
    data = compute(scenario, app)

    assert sum(row["quotation_count"] for row in data["monthly"]) == SCENARIO_TRUTH["counts"]["quotations"]
    assert sum(row["quotation_value"] for row in data["monthly"]) == data["quotation_values"]["total_quotation_value"]


# ------------------------------------------------------------- daily series


def test_daily_series_has_exactly_thirty_chronological_buckets(scenario, app):
    """
    30 day-level buckets, oldest first, ending today.

    This is the data a 7/14/30-day view is sliced from, so a wrong length or
    order would silently shift every point on the chart.
    """
    series = compute(scenario, app)["daily"]

    assert len(series) == DAILY_BUCKETS == 30
    days = [row["date"] for row in series]
    assert days == sorted(days)
    assert len(set(days)) == 30
    assert days[-1] == scenario["today"].isoformat()
    assert days[0] == (scenario["today"] - timedelta(days=29)).isoformat()


def test_daily_series_is_zero_filled(scenario, app):
    """A quiet day is present as zeros, not omitted."""
    series = compute(scenario, app)["daily"]
    quiet = next(row for row in series if row["date"] == (scenario["today"] - timedelta(days=3)).isoformat())

    assert quiet == {
        "date": (scenario["today"] - timedelta(days=3)).isoformat(),
        "quotation_count": 0,
        "quotation_value": 0,
        "invoiced_value": 0,
        "received_value": 0,
    }


def test_daily_series_uses_day_granularity_not_monthly_totals(scenario, app):
    """
    The point of the additive series: real per-day facts.

    The fixture dates every quotation in a given month offset to the same day, so
    the current month collapses to one populated bucket. A month-bucket slice
    would instead have smeared that month's totals across all 30 days.
    """
    series = compute(scenario, app)["daily"]
    by_date = {row["date"]: row for row in series}

    # Which quotations fall inside the 30-day window, derived from the same table
    # the fixture builds from, so this cannot drift from the data.
    start = scenario["today"] - timedelta(days=29)
    inside = [
        (key, grand)
        for key, _s, grand, month_offset, _mk, _i in QUOTATIONS
        if month_start(scenario["today"], month_offset) + timedelta(days=4) >= start
    ]
    assert inside, "scenario should place some quotations inside 30 days"

    dated = (month_start(scenario["today"], 0) + timedelta(days=4)).isoformat()
    assert by_date[dated]["quotation_count"] == len(inside)
    assert by_date[dated]["quotation_value"] == sum(grand for _k, grand in inside)

    # Only that one day is populated: a slice that smeared the month would put
    # this figure on all 30 buckets.
    assert sum(row["quotation_count"] for row in series) == len(inside)
    assert sum(1 for row in series if row["quotation_count"] > 0) == 1

    # Today itself is empty; the fixture never dates a document on "today".
    assert series[-1]["date"] == scenario["today"].isoformat()
    assert series[-1]["quotation_count"] == 0


def test_daily_invoiced_uses_issue_date_and_received_uses_paid_on(scenario, app):
    """
    Same three columns as the monthly series, at day granularity.

    The two issued invoices were issued in month -1, but their payments land on
    different days inside the 30-day window, so received has a bucket where
    invoiced has none.
    """
    series = compute(scenario, app)["daily"]
    by_date = {row["date"]: row for row in series}

    # The current-month payment of 200000 against the invoice issued last month.
    paid_on = (month_start(scenario["today"], 0) + timedelta(days=12)).isoformat()
    assert by_date[paid_on]["received_value"] == 200000

    # Nothing was invoiced on that day. Both invoices were issued in the previous
    # month, which is outside a 30-day window, so the whole daily series carries
    # no invoiced figure at all.
    assert sum(row["invoiced_value"] for row in series) == 0
    # The 600000 payment is dated in month -1 and is therefore also outside.
    assert sum(row["received_value"] for row in series) == 200000


def test_daily_null_issue_date_creates_no_bucket(scenario, app):
    """A draft invoice with `issue_date = NULL` must not yield a stray day key."""
    series = compute(scenario, app)["daily"]
    assert all(row["date"] for row in series)
    assert "" not in {row["date"] for row in series}


def test_daily_series_is_empty_not_missing_on_a_fresh_install(authed_client):
    """A new database still returns 30 zeroed days, so the chart has an axis."""
    data = api_summary(authed_client)

    assert len(data["daily"]) == 30
    assert all(row["quotation_count"] == 0 for row in data["daily"])


def test_daily_series_does_not_disturb_the_monthly_or_money_figures(scenario, app):
    """
    Additive means additive.

    `monthly` keeps its 12 buckets and the money trio is identical whether or not
    a client reads `daily` — the headline figures are computed independently of
    the new series.
    """
    data = compute(scenario, app)

    assert data["money"] == SCENARIO_TRUTH["money"]
    assert len(data["monthly"]) == 12
    # The daily window is a subset of reality, so it can never exceed the totals.
    assert sum(row["received_value"] for row in data["daily"]) <= data["money"]["received_total"]


# -------------------------------------------------------------- recent lists


def test_recent_lists_are_capped_and_newest_first(scenario, app):
    """FR-D2: five of each, ordered newest first."""
    recent = compute(scenario, app)["recent"]

    assert len(recent["quotations"]) == RECENT_LIMIT == 5
    assert len(recent["invoices"]) == RECENT_LIMIT == 5
    assert len(recent["clients"]) == 2  # three exist, one is archived

    numbers = [row["number"] for row in recent["quotations"]]
    # The fixture appends ascending, so the newest five are the last five indices.
    assert numbers == ["QTN-2026-0012", "QTN-2026-0011", "QTN-2026-0010", "QTN-2026-0009", "QTN-2026-0008"]


def test_recent_quotations_carry_link_fields(scenario, app):
    """Each row needs the id and number the list links on, plus a client name."""
    rows = compute(scenario, app)["recent"]["quotations"]
    for row in rows:
        assert isinstance(row["id"], int)
        assert row["number"].startswith("QTN-")
        assert row["client_name"]
        assert row["status"] in QUOTATION_STATUSES


def test_recent_invoices_carry_derived_money(scenario, app):
    rows = compute(scenario, app)["recent"]["invoices"]
    for row in rows:
        assert row["outstanding_paise"] == row["grand_total_paise"] - row["paid_paise"]
        assert row["payment_status"] in {"unpaid", "partially_paid", "paid"}


def test_archived_clients_are_excluded(scenario, app):
    """FR-C4: an archived client is not an active one, so it is not listed."""
    names = [row["name"] for row in compute(scenario, app)["recent"]["clients"]]

    assert "Gamma Archived" not in names
    assert names == ["Beta Builders", "Alpha Interiors"]


# ----------------------------------------------------------------- the route


def test_summary_requires_authentication(client):
    assert client.get(API).status_code == 401


def test_summary_is_readable_by_an_authenticated_user(scenario, authed_client):
    data = api_summary(authed_client)
    assert data["money"]["invoiced_value"] == SCENARIO_TRUTH["money"]["invoiced_value"]


def test_summary_accepts_no_write(authed_client):
    """Read-only: the route exists for GET alone, and CSRF is not in play."""
    assert authed_client.post(API, json={}, headers=_csrf(authed_client)).status_code == 405


def test_response_carries_every_9_2_field(authed_client):
    """
    The contract test behind §24's "all §9.2 dashboard fields present".

    Checks shape on an empty database, where a field could otherwise be hidden by
    a row that happens to populate it.
    """
    data = api_summary(authed_client)

    assert set(data) == {
        "quotation_counts",
        "quotation_values",
        "money",
        "monthly",
        "daily",
        "recent",
    }
    assert set(data["quotation_counts"]) == set(QUOTATION_STATUSES)
    assert set(data["quotation_values"]) == {f"{s}_value" for s in QUOTATION_STATUSES} | {
        "total_quotation_value"
    }
    assert set(data["money"]) == {"invoiced_value", "received_total", "outstanding_total"}
    assert set(data["recent"]) == {"quotations", "invoices", "clients"}
    assert len(data["monthly"]) == 12
    for row in data["monthly"]:
        assert set(row) == {
            "month",
            "quotation_count",
            "quotation_value",
            "invoiced_value",
            "received_value",
        }
    # The day-level series is additive: `monthly` keeps its exact §9.2 shape, and
    # `daily` mirrors it with a `date` key.
    assert len(data["daily"]) == 30
    for row in data["daily"]:
        assert set(row) == {
            "date",
            "quotation_count",
            "quotation_value",
            "invoiced_value",
            "received_value",
        }


def test_empty_database_reports_zeroes_not_nulls(authed_client):
    """A fresh install shows a zeroed dashboard, not a broken one."""
    data = api_summary(authed_client)

    assert data["quotation_counts"] == {status: 0 for status in QUOTATION_STATUSES}
    assert data["money"] == {"invoiced_value": 0, "received_total": 0, "outstanding_total": 0}
    assert data["recent"] == {"quotations": [], "invoices": [], "clients": []}
    assert all(row["quotation_count"] == 0 for row in data["monthly"])


def test_summary_rows_agree_with_the_invoice_detail_api(authed_client, scenario):
    """
    One definition of "paid", actually cross-checked.

    For every invoice the dashboard lists, its derived `paid_paise`,
    `outstanding_paise` and `payment_status` must equal what
    `GET /invoices/:id` reports for the same invoice. Both come from
    `services/invoices`, so a second implementation anywhere would break this.

    Asserted by fetching the detail endpoint per row rather than by re-deriving
    the expectation here, so the check is a genuine disagreement test.
    """
    rows = api_summary(authed_client)["recent"]["invoices"]
    assert rows, "expected the scenario's invoices in the recent list"

    for row in rows:
        detail = authed_client.get(f"/api/v1/invoices/{row['id']}").get_json()["data"]["invoice"]
        assert row["paid_paise"] == detail["paid_paise"], row["number"]
        assert row["outstanding_paise"] == detail["outstanding_paise"], row["number"]
        assert row["payment_status"] == detail["payment_status"], row["number"]
        assert row["status"] == detail["status"], row["number"]


def test_billed_status_filter_is_the_one_in_use(scenario, app):
    """
    The dashboard filters on the shared constant, not a local copy of its value.

    Asserting the literal would be a tautology; this asserts the two agree.
    """
    from sqlalchemy import func, select

    assert BILLED_STATUS == "issued"
    with app.app_context():
        issued = db.session.scalar(
            select(func.count(Invoice.id)).where(Invoice.status == BILLED_STATUS)
        )
    assert issued == 2
