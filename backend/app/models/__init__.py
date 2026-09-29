"""
Ruchita Interiors — ORM models.

Phase 2 registered `User`; Phase 3 registers the full §8.3 schema. Because
Alembic owns DDL (§8.1), every model here is mirrored in
`migrations/versions/4cb5324d6e1e_phase_3_schema.py`, not in a `create_all()`.
"""

from app.extensions.database import db
from app.models.client import Client
from app.models.company_settings import CompanySettings
from app.models.counter import NumberingCounter
from app.models.invoice import Invoice, InvoiceItem, Payment
from app.models.quotation import Quotation, QuotationItem
from app.models.terms import TermsConditions
from app.models.user import User, utcnow, verify_dummy

__all__ = [
    "db",
    "Client",
    "CompanySettings",
    "Invoice",
    "InvoiceItem",
    "NumberingCounter",
    "Payment",
    "Quotation",
    "QuotationItem",
    "TermsConditions",
    "User",
    "utcnow",
    "verify_dummy",
]
