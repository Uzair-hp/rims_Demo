"""
Ruchita Interiors — Service model (SERVICES_PLAN §4.1, Phase 9A).

The services catalog is a **rate card, not a locked price list** (S1): `rate_paise`
is the *standard* rate a quotation line starts from, and every line stores its own
*agreed* rate. Nothing in the calculation core reads this table (S7).

Two rules the table itself enforces:

- **Rate must be positive** (S3). `§10.3` blocks *Send* on any line with rate 0,
  so a "free site visit" service would make quotations unsendable — the CHECK
  turns that into a database error rather than a saved trap.
- **Archive, never delete** (S5, FR-SV2). Old quotation and invoice lines keep a
  `RESTRICT` FK pointing here, so a hard delete is never exposed — exactly the
  clients pattern (FR-C4, D9).

The partial unique index on `lower(name)` among *active* rows (FR-SV3) is declared
after the columns because its expression references the `name` Column object;
`__table_args__` is read wherever it sits in the class body.
"""

from __future__ import annotations

from app.extensions.database import db
from app.models.user import utcnow


class Service(db.Model):
    __tablename__ = "services"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(100))
    description = db.Column(db.Text)
    unit = db.Column(db.String(50), nullable=False, default="job", server_default="job")
    # Milli-units, the same integer quantity the line items use (§8.1), so a
    # default of 1.5 sqft is stored as 1500 and pre-fills a line with no conversion.
    default_qty_milli = db.Column(db.Integer, nullable=False, default=1000, server_default="1000")
    rate_paise = db.Column(db.Integer, nullable=False)
    archived_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        # FR-SV4: the list sorts category then name, so the index serves the
        # default order and the archived filter together.
        db.Index("ix_services_archived_category_name", "archived_at", "category", "name"),
        # FR-SV3: duplicate names are blocked among *active* services only — an
        # archived service's name can be reused. Declared as a functional index so
        # the database is the backstop behind the service-layer 409, not the only
        # check. SQLite expression index; the migration writes the same DDL.
        db.Index(
            "uq_services_active_name",
            db.func.lower(name),
            unique=True,
            sqlite_where=db.text("archived_at IS NULL"),
        ),
        # S3: the standard rate is the seed of every line it pre-fills, and a
        # zero-rate line can never be sent (§10.3).
        db.CheckConstraint(
            "rate_paise > 0 AND rate_paise <= 1000000000000",
            name="ck_services_rate_positive",
        ),
        db.CheckConstraint(
            "default_qty_milli >= 0",
            name="ck_services_default_qty_nonnegative",
        ),
    )

    # ----------------------------------------------------------- archive state

    @property
    def is_archived(self) -> bool:
        """FR-SV2: `archived_at` set hides the service from lists and the picker."""
        return self.archived_at is not None

    # ----------------------------------------------------------- serialising

    def to_dict(self) -> dict:
        """Full representation for the Services list, form and (later) the picker."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "unit": self.unit,
            "default_qty_milli": self.default_qty_milli,
            "rate_paise": self.rate_paise,
            "is_archived": self.is_archived,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Service id={self.id} name={self.name!r} archived={self.is_archived}>"
