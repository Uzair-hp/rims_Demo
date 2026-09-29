"""
Ruchita Interiors — settings endpoints (§9.2).

    GET  /api/v1/settings/company      -> the singleton row
    PUT  /api/v1/settings/company      -> save the editable fields
    GET  /api/v1/settings/terms        -> all terms entries
    POST /api/v1/settings/terms        -> create one
    PUT  /api/v1/settings/terms/:id    -> update one
    DELETE /api/v1/settings/terms/:id  -> delete one

Every route is behind `@login_required`: settings are owner-only data (§16).
The §15 rule "changing settings needs no code change" is exercised by these
endpoints alone — documents read this row live in later phases.
"""

from __future__ import annotations

from flask import Blueprint, request

from app.schemas import CompanySettingsSchema, TermsSchema, TermsUpdateSchema, load_or_raise
from app.services import settings as settings_service
from app.utils.errors import success
from app.utils.guards import login_required

settings_bp = Blueprint("settings", __name__, url_prefix="/settings")


@settings_bp.get("/company")
@login_required
def get_company_settings():
    row = settings_service.get_settings()
    return success({"settings": row.to_dict()})


@settings_bp.put("/company")
@login_required
def update_company_settings():
    payload = load_or_raise(CompanySettingsSchema(), request_json())
    row = settings_service.save_settings(payload)
    return success({"settings": row.to_dict()})


@settings_bp.get("/terms")
@login_required
def list_terms():
    terms = settings_service.list_terms()
    return success({"terms": [term.to_dict() for term in terms]})


@settings_bp.post("/terms")
@login_required
def create_term():
    payload = load_or_raise(TermsSchema(), request_json())
    term = settings_service.create_term(payload)
    return success({"term": term.to_dict()}, status=201)


@settings_bp.put("/terms/<int:term_id>")
@login_required
def update_term(term_id: int):
    payload = load_or_raise(TermsUpdateSchema(), request_json())
    term = settings_service.update_term(term_id, payload)
    return success({"term": term.to_dict()})


@settings_bp.delete("/terms/<int:term_id>")
@login_required
def delete_term(term_id: int):
    settings_service.delete_term(term_id)
    return success({"deleted": True})


def request_json() -> dict | None:
    """Silent parse, so an empty or malformed body is a 422 rather than a 500."""
    return request.get_json(silent=True)
