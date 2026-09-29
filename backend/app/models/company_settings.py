"""
Ruchita Interiors — CompanySettings model (§8.3, §15).

One row (`id = 1`), insert-guarded. Every section of the Settings UI reads and
writes this row; documents snapshot their values at creation, so editing this
row never rewrites issued history (§8.4).

Money, tax and quantity values are integers in the §8.1 primitives: GST in
basis points (1800 = 18%), validity in whole days.
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint
from sqlalchemy.orm import validates

from app.extensions.database import db
from app.models.user import utcnow

SINGLETON_ID = 1

# §15 catalogue lists arrive from §8.3 of the original requirements.
DEFAULT_ITEM_CATEGORIES = [
    "Living Room",
    "Bedroom",
    "Kitchen",
    "Bathroom",
    "Wardrobe",
    "Furniture",
    "Electrical",
    "Civil Work",
    "False Ceiling",
    "Painting",
    "Other",
]

DEFAULT_UNITS = ["sq.ft", "running ft", "no.", "set", "job", "hrs", "days"]

# §15 defaults, echoed in the seed CLI and the schema validators.
DEFAULT_QUOTATION_PREFIX = "QTN"
DEFAULT_INVOICE_PREFIX = "INV"
DEFAULT_GST_BP = 1800
DEFAULT_VALIDITY_DAYS = 15


class CompanySettings(db.Model):
    """The single configurable row every document reads its defaults from."""

    __tablename__ = "company_settings"

    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(200), nullable=False, server_default="Ruchita Interiors")
    tagline = db.Column(db.String(200))
    logo_path = db.Column(db.String(255))
    phone = db.Column(db.String(32))
    email = db.Column(db.String(254))
    website = db.Column(db.String(200))
    address_line1 = db.Column(db.String(200))
    address_line2 = db.Column(db.String(200))
    city = db.Column(db.String(100))
    state = db.Column(db.String(100))
    pincode = db.Column(db.String(12))
    gstin = db.Column(db.String(15))

    # --- Document defaults (§15) ---
    default_gst_bp = db.Column(
        db.Integer,
        CheckConstraint("default_gst_bp >= 0 AND default_gst_bp <= 2800"),
        nullable=False,
        server_default=str(DEFAULT_GST_BP),
    )
    default_validity_days = db.Column(
        db.Integer,
        CheckConstraint("default_validity_days >= 0 AND default_validity_days <= 365"),
        nullable=False,
        server_default=str(DEFAULT_VALIDITY_DAYS),
    )
    quotation_prefix = db.Column(
        db.String(12), nullable=False, server_default=DEFAULT_QUOTATION_PREFIX
    )
    invoice_prefix = db.Column(db.String(12), nullable=False, server_default=DEFAULT_INVOICE_PREFIX)

    # --- Bank / payment (snapshotted onto invoices at conversion, §8.4) ---
    bank_account_name = db.Column(db.String(200))
    bank_account_number = db.Column(db.String(64))
    bank_name = db.Column(db.String(200))
    bank_ifsc = db.Column(db.String(11))
    bank_branch = db.Column(db.String(200))
    upi_id = db.Column(db.String(100))

    # --- Document / footer (§15) ---
    signatory_name = db.Column(db.String(200))
    footer_text = db.Column(db.String(500))

    # --- Catalogue (§4.8 FR-S5): JSON arrays of free-text suggestions ---
    item_categories = db.Column(db.JSON, nullable=False, server_default="[]")
    units = db.Column(db.JSON, nullable=False, server_default="[]")

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    @validates("quotation_prefix", "invoice_prefix")
    def _strip_prefix(self, _key: str, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    # ------------------------------------------------------------- fetching

    @classmethod
    def get_row(cls) -> "CompanySettings":
        """
        Return the settings row, creating it if absent.

        GET /settings/company and every seed path funnel through here, so a
        missing row is never a 500: the defaults in this model are the response.
        Seeding makes no code change unnecessary — a fresh database answers
        correctly before `flask seed-defaults` has ever run.
        """
        row = db.session.get(cls, SINGLETON_ID)
        if row is None:
            row = cls(id=SINGLETON_ID)
            if not row.item_categories:
                row.item_categories = list(DEFAULT_ITEM_CATEGORIES)
            if not row.units:
                row.units = list(DEFAULT_UNITS)
            db.session.add(row)
            db.session.commit()
        return row

    # Alias: numbering/quotation services and their tests refer to the row this
    # way. Same insert-guarded fetch, one name so callers read naturally.
    @classmethod
    def get_or_create(cls) -> "CompanySettings":
        return cls.get_row()

    # ----------------------------------------------------------- serialising

    def to_dict(self) -> dict:
        """Full representation for the Settings UI and document defaults."""
        return {
            "company_name": self.company_name,
            "tagline": self.tagline,
            "logo_path": self.logo_path,
            "phone": self.phone,
            "email": self.email,
            "website": self.website,
            "address_line1": self.address_line1,
            "address_line2": self.address_line2,
            "city": self.city,
            "state": self.state,
            "pincode": self.pincode,
            "gstin": self.gstin,
            "default_gst_bp": self.default_gst_bp,
            "default_validity_days": self.default_validity_days,
            "quotation_prefix": self.quotation_prefix,
            "invoice_prefix": self.invoice_prefix,
            "bank_account_name": self.bank_account_name,
            "bank_account_number": self.bank_account_number,
            "bank_name": self.bank_name,
            "bank_ifsc": self.bank_ifsc,
            "bank_branch": self.bank_branch,
            "upi_id": self.upi_id,
            "signatory_name": self.signatory_name,
            "footer_text": self.footer_text,
            "item_categories": list(self.item_categories or []),
            "units": list(self.units or []),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
