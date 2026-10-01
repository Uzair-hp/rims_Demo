"""
Ruchita Interiors — Quotations API (§9.2).

Endpoints:
- GET    /quotations                    — list with search/filters/sort/pagination
- POST   /quotations                    — create draft (allocates number)
- GET    /quotations/:id                — detail with items, totals, allowed_actions
- PUT    /quotations/:id                — full replace (draft/sent only)
- DELETE /quotations/:id                — delete draft/rejected (retires number)
- POST   /quotations/:id/status         — send/approve/reject/reopen
- POST   /quotations/:id/duplicate      — create new draft from existing
- POST   /quotations/:id/invoice        — convert to invoice (409 if exists)

The blueprint stays thin (§23): parse and validate, apply the calculation and
lifecycle services, respond in the §9.1 envelope. Every route is `@login_required`;
mutations are also `@csrf_protect` (§16). Error helpers return `ApiError`, which is
an exception — routes `raise` them and the app factory renders the envelope.
"""

from __future__ import annotations

from datetime import date

from flask import Blueprint, request, g
from sqlalchemy import or_, desc, asc

from app.extensions.database import db
from app.models import Client, Quotation, QuotationItem, Service
from app.schemas import load_or_raise
from app.schemas.quotations import (
    quotation_schema,
    quotation_list_query_schema,
    quotation_status_action_schema,
    quotation_duplicate_schema,
)
from app.services.calculations import calculate_totals, calculate_line_total, validate_document
from app.services.numbering import allocate_number
from app.services.invoices import convert_quotation, serialize_invoice
from app.services.lifecycle import (
    get_quotation_allowed_actions,
    validate_quotation_transition,
    QuotationAction,
)
from app.utils.errors import (
    success,
    field_error,
    validation_error,
    business_rule,
    not_found,
)
from app.utils.guards import login_required
from app.services.csrf import csrf_protect

quotations_bp = Blueprint("quotations", __name__, url_prefix="/quotations")


# ---- Helpers ----


def _apply_list_filters(query, params):
    """Apply search, filters, and sorting to the quotation query."""
    q = params.get("q")
    if q:
        # Escape LIKE wildcards so a literal % or _ isn't treated as a pattern (§16).
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        query = query.join(Client, Quotation.client_id == Client.id).filter(
            or_(
                Quotation.number.ilike(like, escape="\\"),
                Client.name.ilike(like, escape="\\"),
            )
        )

    status = params.get("status")
    if status:
        query = query.filter(Quotation.status == status)

    client_id = params.get("client_id")
    if client_id:
        query = query.filter(Quotation.client_id == client_id)

    date_from = params.get("date_from")
    if date_from:
        query = query.filter(Quotation.quotation_date >= date_from)
    date_to = params.get("date_to")
    if date_to:
        query = query.filter(Quotation.quotation_date <= date_to)

    min_amount = params.get("min_amount")
    if min_amount is not None:
        query = query.filter(Quotation.grand_total_paise >= min_amount)
    max_amount = params.get("max_amount")
    if max_amount is not None:
        query = query.filter(Quotation.grand_total_paise <= max_amount)

    sort = params.get("sort", "created_at")
    order = params.get("order", "desc")
    sort_col = getattr(Quotation, sort, Quotation.created_at)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    return query


def _serialize_quotation(quotation: Quotation) -> dict:
    """Serialize a quotation with server-computed lifecycle fields."""
    data = quotation_schema.dump(quotation)
    allowed = get_quotation_allowed_actions(quotation)
    data["allowed_actions"] = allowed.to_list()
    data["is_expired"] = allowed.is_expired
    return data


def _validate_document_or_raise(data: dict) -> None:
    """Run the calculation service's document validation, raising on failure."""
    errors = validate_document(
        line_items=data["items"],
        discount_type=data["discount_type"],
        discount_bp=data.get("discount_bp"),
        discount_fixed_paise=data.get("discount_fixed_paise"),
        gst_bp=data["gst_bp"],
        other_charges_paise=data.get("other_charges_paise", 0),
    )
    if errors:
        raise validation_error(
            errors[0],
            [{"field": "items", "message": e} for e in errors],
        )


def _recompute_and_replace_items(quotation: Quotation, items_data: list[dict]) -> None:
    """Recalculate line + document totals and replace the quotation's items."""
    line_totals = []
    normalized = []
    for i, item_data in enumerate(items_data):
        calc = calculate_line_total(item_data["qty_milli"], item_data["rate_paise"])
        item = {
            "category": item_data.get("category"),
            "name": item_data["name"],
            "description": item_data.get("description"),
            "unit": item_data.get("unit"),
            "qty_milli": item_data["qty_milli"],
            "rate_paise": item_data["rate_paise"],
            "line_total_paise": calc.line_total_paise,
            "position": i,
            # SERVICES_PLAN §4.3: catalog provenance rides along with the line.
            # It never influences `line_total_paise` or any total (S7).
            "service_id": _validated_service_id(item_data.get("service_id")),
            "catalog_rate_paise": item_data.get("catalog_rate_paise"),
        }
        normalized.append(item)
        line_totals.append(calc.line_total_paise)

    totals = calculate_totals(
        line_totals=line_totals,
        discount_type=quotation.discount_type,
        discount_bp=quotation.discount_bp,
        discount_fixed_paise=quotation.discount_fixed_paise,
        gst_bp=quotation.gst_bp,
        other_charges_paise=quotation.other_charges_paise or 0,
    )

    quotation.subtotal_paise = totals.subtotal_paise
    quotation.discount_paise = totals.discount_paise
    quotation.gst_paise = totals.gst_paise
    quotation.grand_total_paise = totals.grand_total_paise

    quotation.items.clear()
    for item in normalized:
        quotation.items.append(QuotationItem(**item))


def _apply_header_fields(quotation: Quotation, data: dict, client: Client) -> None:
    """Copy validated header fields from a loaded payload onto the quotation."""
    quotation.client_id = data["client_id"]
    quotation.client_snapshot = client.to_snapshot()
    quotation.quotation_date = data["quotation_date"]
    quotation.valid_until = data.get("valid_until")
    quotation.discount_type = data["discount_type"]
    quotation.discount_bp = data.get("discount_bp")
    quotation.discount_fixed_paise = data.get("discount_fixed_paise")
    quotation.gst_bp = data["gst_bp"]
    quotation.other_charges_label = data.get("other_charges_label", "Other Charges")
    quotation.other_charges_paise = data.get("other_charges_paise", 0)
    quotation.terms_text = data.get("terms_text")
    quotation.notes = data.get("notes")


def _validated_service_id(service_id):
    """
    Check a catalog reference before it is stored on a line (SERVICES_PLAN §4.3).

    An unknown id is a 422 (edge case 7). A **known but archived** id is accepted,
    so a draft that already contains a since-archived service can still be saved —
    it just cannot be added again (edge case 2). `None` means "typed by hand" and
    passes untouched.
    """
    if service_id is None:
        return None
    if db.session.get(Service, service_id) is None:
        raise field_error("items", "One of the line items refers to a service that does not exist.")
    return service_id


def _get_or_404(quotation_id: int) -> Quotation:
    quotation = db.session.get(Quotation, quotation_id)
    if not quotation:
        raise not_found("Quotation not found.")
    return quotation


# ---- Routes ----


@quotations_bp.get("")
@login_required
def list_quotations():
    """GET /quotations — list with search/filters/sort/pagination."""
    params = load_or_raise(quotation_list_query_schema, request.args.to_dict())
    page = params.pop("page")
    page_size = params.pop("page_size")

    query = _apply_list_filters(Quotation.query, params)

    pagination = query.paginate(page=page, per_page=page_size, error_out=False)
    items = [_serialize_quotation(q) for q in pagination.items]

    return success({
        "items": items,
        "page": pagination.page,
        "page_size": pagination.per_page,
        "total": pagination.total,
    })


@quotations_bp.post("")
@login_required
@csrf_protect
def create_quotation():
    """POST /quotations — create a new draft (allocates a number)."""
    data = load_or_raise(quotation_schema, request.get_json(silent=True))

    client = db.session.get(Client, data["client_id"])
    if not client:
        raise field_error("client_id", "Client not found.")

    _validate_document_or_raise(data)

    allocation = allocate_number("quotation")

    quotation = Quotation(
        number=allocation.number,
        year=allocation.year,
        status="draft",
        created_by=g.current_user.id,
    )
    _apply_header_fields(quotation, data, client)
    _recompute_and_replace_items(quotation, data["items"])

    db.session.add(quotation)
    db.session.commit()

    return success({"quotation": _serialize_quotation(quotation)}, status=201)


@quotations_bp.get("/<int:quotation_id>")
@login_required
def get_quotation(quotation_id: int):
    """GET /quotations/:id — detail with items, totals, allowed_actions."""
    quotation = _get_or_404(quotation_id)
    return success({"quotation": _serialize_quotation(quotation)})


@quotations_bp.put("/<int:quotation_id>")
@login_required
@csrf_protect
def update_quotation(quotation_id: int):
    """PUT /quotations/:id — full replace (draft or sent only)."""
    quotation = _get_or_404(quotation_id)

    if quotation.status not in ("draft", "sent"):
        raise business_rule("Only draft or sent quotations can be edited.")

    data = load_or_raise(quotation_schema, request.get_json(silent=True))

    client = db.session.get(Client, data["client_id"])
    if not client:
        raise field_error("client_id", "Client not found.")

    _validate_document_or_raise(data)

    _apply_header_fields(quotation, data, client)
    _recompute_and_replace_items(quotation, data["items"])

    db.session.commit()

    return success({"quotation": _serialize_quotation(quotation)})


@quotations_bp.delete("/<int:quotation_id>")
@login_required
@csrf_protect
def delete_quotation(quotation_id: int):
    """DELETE /quotations/:id — delete a draft or rejected quotation."""
    quotation = _get_or_404(quotation_id)

    if quotation.status not in ("draft", "rejected"):
        raise business_rule("Only draft or rejected quotations can be deleted.")

    db.session.delete(quotation)
    db.session.commit()

    return success({"deleted": True})


@quotations_bp.post("/<int:quotation_id>/status")
@login_required
@csrf_protect
def update_quotation_status(quotation_id: int):
    """POST /quotations/:id/status — send/approve/reject/reopen."""
    quotation = _get_or_404(quotation_id)

    data = load_or_raise(quotation_status_action_schema, request.get_json(silent=True))
    action = QuotationAction(data["action"])

    allowed, error = validate_quotation_transition(quotation, action)
    if not allowed:
        raise business_rule(error or "That action is not allowed right now.")

    if action == QuotationAction.SEND:
        quotation.status = "sent"
    elif action == QuotationAction.APPROVE:
        quotation.status = "approved"
    elif action == QuotationAction.REJECT:
        quotation.status = "rejected"
    elif action == QuotationAction.REOPEN:
        quotation.status = "draft"

    db.session.commit()

    return success({"quotation": _serialize_quotation(quotation)})


@quotations_bp.post("/<int:quotation_id>/duplicate")
@login_required
@csrf_protect
def duplicate_quotation(quotation_id: int):
    """POST /quotations/:id/duplicate — create a fresh draft from an existing one."""
    original = _get_or_404(quotation_id)
    load_or_raise(quotation_duplicate_schema, request.get_json(silent=True) or {})

    allocation = allocate_number("quotation")

    items_data = [
        {
            "category": item.category,
            "name": item.name,
            "description": item.description,
            "unit": item.unit,
            "qty_milli": item.qty_milli,
            "rate_paise": item.rate_paise,
            # SERVICES_PLAN FR-SV8: a duplicate copies the catalog provenance
            # unchanged, exactly as §8.4 snapshot semantics require.
            "service_id": item.service_id,
            "catalog_rate_paise": item.catalog_rate_paise,
        }
        for item in original.items
    ]

    quotation = Quotation(
        number=allocation.number,
        year=allocation.year,
        client_id=original.client_id,
        client_snapshot=original.client_snapshot,
        quotation_date=date.today(),
        valid_until=None,
        status="draft",
        discount_type=original.discount_type,
        discount_bp=original.discount_bp,
        discount_fixed_paise=original.discount_fixed_paise,
        gst_bp=original.gst_bp,
        other_charges_label=original.other_charges_label,
        other_charges_paise=original.other_charges_paise,
        terms_text=original.terms_text,
        notes=original.notes,
        created_by=g.current_user.id,
    )
    _recompute_and_replace_items(quotation, items_data)

    db.session.add(quotation)
    db.session.commit()

    return success({"quotation": _serialize_quotation(quotation)}, status=201)


@quotations_bp.post("/<int:quotation_id>/invoice")
@login_required
@csrf_protect
def create_invoice_from_quotation(quotation_id: int):
    """
    POST /quotations/:id/invoice — convert an approved quotation (FR-I1).

    The business rule, the snapshot and the §11 safety assert all live in
    `services/invoices.convert_quotation`; this route stays thin (§23) and returns
    the full invoice so the client can navigate straight to it.
    """
    quotation = _get_or_404(quotation_id)
    invoice = convert_quotation(quotation, created_by=g.current_user.id)
    return success({"invoice": serialize_invoice(invoice)}, status=201)
