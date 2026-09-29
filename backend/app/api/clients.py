"""
Ruchita Interiors — clients endpoints (§9.2, §4.2).

    GET    /api/v1/clients?q=&include_archived=&page=&page_size=
    POST   /api/v1/clients
    GET    /api/v1/clients/:id
    PUT    /api/v1/clients/:id
    DELETE /api/v1/clients/:id            -> archive (soft delete)
    POST   /api/v1/clients/:id/restore    -> clear the archive
    GET    /api/v1/clients/:id/summary    -> relationship history + totals

The blueprint stays thin (§23): parse and validate, call one service function,
respond in the §9.1 envelope. Every route is `@login_required`; the two mutations
are also `@csrf_protect`, per §16.
"""

from __future__ import annotations

from flask import Blueprint, request

from app.schemas import ClientSchema, load_or_raise
from app.services import clients as clients_service
from app.services.csrf import csrf_protect
from app.utils.errors import success
from app.utils.guards import login_required

clients_bp = Blueprint("clients", __name__, url_prefix="/clients")


@clients_bp.get("")
@login_required
def list_clients():
    q = request.args.get("q")
    include_archived = _as_bool(request.args.get("include_archived"))
    page = _as_int(request.args.get("page"), 1)
    page_size = _as_int(request.args.get("page_size"), clients_service.DEFAULT_PAGE_SIZE)

    items, total = clients_service.list_clients(
        q=q, include_archived=include_archived, page=page, page_size=page_size
    )
    return success(
        {
            "items": [client.to_dict() for client in items],
            "page": max(1, page),
            "page_size": min(max(1, page_size), clients_service.MAX_PAGE_SIZE),
            "total": total,
        }
    )


@clients_bp.post("")
@login_required
@csrf_protect
def create_client():
    payload = load_or_raise(ClientSchema(), request.get_json(silent=True))
    client = clients_service.create_client(payload)
    return success({"client": client.to_dict()}, status=201)


@clients_bp.get("/<int:client_id>")
@login_required
def get_client(client_id: int):
    # Works for archived clients too, so a history deep link never 404s (FR-C4).
    return success({"client": clients_service.get_client(client_id).to_dict()})


@clients_bp.put("/<int:client_id>")
@login_required
@csrf_protect
def update_client(client_id: int):
    payload = load_or_raise(ClientSchema(), request.get_json(silent=True))
    client = clients_service.update_client(client_id, payload)
    return success({"client": client.to_dict()})


@clients_bp.delete("/<int:client_id>")
@login_required
@csrf_protect
def archive_client(client_id: int):
    """Soft delete (FR-C4): no hard-delete endpoint is ever exposed."""
    client = clients_service.archive_client(client_id)
    return success({"client": client.to_dict()})


@clients_bp.post("/<int:client_id>/restore")
@login_required
@csrf_protect
def restore_client(client_id: int):
    client = clients_service.restore_client(client_id)
    return success({"client": client.to_dict()})


@clients_bp.get("/<int:client_id>/summary")
@login_required
def client_summary(client_id: int):
    return success(clients_service.client_summary(client_id))


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