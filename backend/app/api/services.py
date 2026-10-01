"""
Ruchita Interiors — services endpoints (SERVICES_PLAN §5, Phase 9A).

    GET    /api/v1/services?q=&category=&include_archived=&page=&page_size=
    POST   /api/v1/services
    GET    /api/v1/services/:id
    PUT    /api/v1/services/:id
    DELETE /api/v1/services/:id            -> archive (soft delete, S5)
    POST   /api/v1/services/:id/restore    -> clear the archive

The blueprint mirrors `clients` exactly (§23): parse and validate, call one
service function, respond in the §9.1 envelope. Every route is
`@login_required`; the mutations are also `@csrf_protect`, per §16.

`DELETE` archives and never hard-deletes, so the endpoint the name suggests does
not exist — old quotation and invoice lines keep pointing at the service (S5).
"""

from __future__ import annotations

from flask import Blueprint, request

from app.schemas import ServiceSchema, load_or_raise
from app.services import services as services_service
from app.services.csrf import csrf_protect
from app.utils.errors import success
from app.utils.guards import login_required

services_bp = Blueprint("services", __name__, url_prefix="/services")


@services_bp.get("")
@login_required
def list_services():
    q = request.args.get("q")
    category = request.args.get("category")
    include_archived = _as_bool(request.args.get("include_archived"))
    page = _as_int(request.args.get("page"), 1)
    page_size = _as_int(request.args.get("page_size"), services_service.DEFAULT_PAGE_SIZE)

    items, total = services_service.list_services(
        q=q,
        category=category,
        include_archived=include_archived,
        page=page,
        page_size=page_size,
    )
    return success(
        {
            "items": [service.to_dict() for service in items],
            # The categories in use, for the list page's chip scroller (§6).
            # Returned with every list response so the facet can never disagree
            # with the rows — one request, one query set (§9.2).
            "categories": services_service.distinct_categories(),
            "page": max(1, page),
            "page_size": min(max(1, page_size), services_service.MAX_PAGE_SIZE),
            "total": total,
        }
    )


@services_bp.post("")
@login_required
@csrf_protect
def create_service():
    payload = load_or_raise(ServiceSchema(), request.get_json(silent=True))
    service = services_service.create_service(payload)
    return success({"service": service.to_dict()}, status=201)


@services_bp.get("/<int:service_id>")
@login_required
def get_service(service_id: int):
    # Works for archived services too, so a stale tab never 404s (FR-SV2).
    return success({"service": services_service.get_service(service_id).to_dict()})


@services_bp.put("/<int:service_id>")
@login_required
@csrf_protect
def update_service(service_id: int):
    payload = load_or_raise(ServiceSchema(), request.get_json(silent=True))
    service = services_service.update_service(service_id, payload)
    return success({"service": service.to_dict()})


@services_bp.delete("/<int:service_id>")
@login_required
@csrf_protect
def archive_service(service_id: int):
    """Soft delete (S5): a hard-delete endpoint is never exposed."""
    service = services_service.archive_service(service_id)
    return success({"service": service.to_dict()})


@services_bp.post("/<int:service_id>/restore")
@login_required
@csrf_protect
def restore_service(service_id: int):
    service = services_service.restore_service(service_id)
    return success({"service": service.to_dict()})


# ------------------------------------------------------------------- helpers


def _as_bool(value: str | None) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"} if value is not None else False


def _as_int(value: str | None, default: int) -> int:
    try:
        return int(value) if value is not None and str(value).strip() else default
    except (TypeError, ValueError):
        # A malformed query parameter falls back to the default rather than
        # 500-ing the list; the service clamps the range either way.
        return default
