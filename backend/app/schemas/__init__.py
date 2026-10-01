"""
Ruchita Interiors — Marshmallow schemas.

Each domain gets a module here. `auth.py` is Phase 2; Phase 3 adds `settings.py`
for the §15 sections; Phase 5 adds `quotations.py`.
"""

from app.schemas.auth import ChangePasswordSchema, LoginSchema, load_or_raise
from app.schemas.clients import ClientSchema
from app.schemas.quotations import (
    invoice_draft_schema,
    invoice_list_query_schema,
    invoice_schema,
    payment_schema,
    quotation_duplicate_schema,
    quotation_list_query_schema,
    quotation_schema,
    quotation_status_action_schema,
)
from app.schemas.services import ServiceSchema
from app.schemas.settings import CompanySettingsSchema, TermsSchema, TermsUpdateSchema

__all__ = [
    "ChangePasswordSchema",
    "ClientSchema",
    "CompanySettingsSchema",
    "LoginSchema",
    "ServiceSchema",
    "TermsSchema",
    "TermsUpdateSchema",
    "load_or_raise",
    "quotation_schema",
    "quotation_list_query_schema",
    "quotation_status_action_schema",
    "quotation_duplicate_schema",
    "invoice_schema",
    "invoice_draft_schema",
    "invoice_list_query_schema",
    "payment_schema",
]
