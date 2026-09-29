"""
Ruchita Interiors — dashboard API (PLAN §9.2, §23).

    GET /api/v1/dashboard/summary  -> the entire Dashboard, in one response

§9.2 is explicit that this is **"one request, one query set"**: the page renders
metric cards, two charts and three recent lists from a single fetch, rather than
fanning out to the quotations, invoices, clients and payments endpoints and
re-deriving totals in the browser. Reusing those endpoints would mean the
dashboard recomputed its own money figures in JavaScript, which is the one thing
§11's "computed, never stored" rule exists to prevent.

The blueprint is deliberately thin (§23): authenticate, call the service, respond
in the §9.1 envelope. There is no aggregation here.

`@login_required` but **not** `@csrf_protect`: this is a read-only GET, matching
every other GET in the project. CSRF guards mutations, and there are none here.
"""

from __future__ import annotations

from flask import Blueprint

from app.services.dashboard import dashboard_summary
from app.utils.errors import success
from app.utils.guards import login_required

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/dashboard/summary")
@login_required
def dashboard_summary_route():
    """
    GET /dashboard/summary — every figure the Dashboard renders.

    Returns the §9.2 shape: quotation counts by status, quotation values by
    status, the invoiced/received/outstanding trio, a 12-month series, and the
    three recent lists. All money in paise.
    """
    return success(dashboard_summary())
