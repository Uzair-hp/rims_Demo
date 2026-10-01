"""
Ruchita Interiors — services service (SERVICES_PLAN §5, Phase 9A).

Business rules for the services catalog, kept out of the blueprint (§23: routes
parse, validate, call one function here and respond). The module name collides
with the domain noun — `app.services.services` holds the rules *about* services —
which is the same pattern `app.services.settings` already established.

Four ideas shape it:

- **Archive, never delete** (S5, FR-SV2). `DELETE /services/:id` sets
  `archived_at`; there is no hard-delete endpoint, because quotation and invoice
  lines hold a `RESTRICT` FK to this table and old documents must keep pointing
  at the service they came from.
- **Duplicate names among *active* services only** (FR-SV3). A case-insensitive
  match is a 409; an archived service's name can be reused. Restoring re-checks
  the rule, because an active service may have taken the name while this one was
  archived.
- **Search is an escaped LIKE** (§16), same as clients: `%` and `_` typed by the
  user are literals, not wildcards.
- **The list sorts category then name** (FR-SV4), which is the order a rate card
  is read in — not `updated_at` like clients, because a service has no activity
  signal that matters.
"""

from __future__ import annotations

from sqlalchemy import func, or_, select

from app.extensions.database import db
from app.models import Service
from app.models.user import utcnow
from app.utils.errors import conflict, not_found

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


# ------------------------------------------------------------------- queries


def list_services(
    *,
    q: str | None = None,
    category: str | None = None,
    include_archived: bool = False,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Service], int]:
    """
    Return `(items, total)` for the services list (FR-SV4).

    Default sort is `category, name` — the rate-card order. Archived services are
    hidden unless `include_archived` is set (FR-SV2); the picker relies on that
    default so an archived service can never be added again.
    """
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    statement = select(Service)
    if not include_archived:
        statement = statement.where(Service.archived_at.is_(None))

    term = (q or "").strip()
    if term:
        pattern = f"%{_escape_like(term)}%"
        statement = statement.where(
            or_(
                Service.name.like(pattern, escape="\\"),
                Service.category.like(pattern, escape="\\"),
                Service.description.like(pattern, escape="\\"),
            )
        )

    if category:
        statement = statement.where(Service.category == category.strip())

    total = db.session.scalar(
        select(func.count()).select_from(statement.order_by(None).subquery())
    ) or 0

    rows = (
        db.session.scalars(
            statement.order_by(Service.category.asc().nulls_last(), Service.name.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return list(rows), total


def distinct_categories() -> list[str]:
    """
    The categories in use among *active* services, alphabetical, for the list
    page's chip scroller (SERVICES_PLAN §6).

    Derived, never stored as a second list: a category is free text on the row
    (S6), so the facet is just `SELECT DISTINCT` over it. Archived services are
    excluded so a chip never filters down to an empty set of addable services.
    """
    rows = db.session.scalars(
        select(Service.category)
        .where(Service.archived_at.is_(None), Service.category.is_not(None), Service.category != "")
        .distinct()
        .order_by(Service.category.asc())
    ).all()
    return list(rows)


def get_service(service_id: int) -> Service:
    """
    Fetch one service — archived or not (FR-SV2, mirrors FR-C4).

    An archived service's edit URL must keep working so a stale tab can still
    resolve the row it has open.
    """
    service = db.session.get(Service, service_id)
    if service is None:
        raise not_found("That service could not be found.")
    return service


# ------------------------------------------------------------------ mutations


def create_service(payload: dict) -> Service:
    """Create one service, refusing a duplicate active name (FR-SV3)."""
    name = payload["name"]
    _ensure_unique_name(name)
    service = Service(**_editable_fields(payload))
    db.session.add(service)
    db.session.commit()
    return service


def update_service(service_id: int, payload: dict) -> Service:
    """
    Update one service (FR-SV5: affects new quotation lines only — the endpoint
    docstring says so and the model has no back-reference to enforce it).

    The duplicate check excludes the row being edited, so renaming a service to
    its own name (re-typed, different case) is not a conflict with itself.
    """
    service = get_service(service_id)
    name = payload["name"]
    _ensure_unique_name(name, exclude_id=service.id)
    for field, value in _editable_fields(payload).items():
        setattr(service, field, value)
    db.session.commit()
    return service


def archive_service(service_id: int) -> Service:
    """
    Soft-delete (S5, FR-SV2). Idempotent, like clients: the confirmation dialog
    can be re-submitted by an impatient double tap without a 409.
    """
    service = get_service(service_id)
    if service.archived_at is None:
        service.archived_at = utcnow()
        db.session.commit()
    return service


def restore_service(service_id: int) -> Service:
    """
    Clear the archive (FR-SV2).

    Two 409s, both meaningful rather than pedantic:
    - restoring an active service means the page was stale (the Restore button is
      only rendered for archived rows);
    - restoring when an active service now owns the name (FR-SV3) — the user must
      rename one of the two, and the message says which.
    """
    service = get_service(service_id)
    if service.archived_at is None:
        raise conflict("That service is already active.")
    _ensure_unique_name(service.name, exclude_id=service.id)
    service.archived_at = None
    db.session.commit()
    return service


# ------------------------------------------------------------------- helpers


def _ensure_unique_name(name: str, *, exclude_id: int | None = None) -> None:
    """
    FR-SV3: no two *active* services share a name, case-insensitively.

    Archived rows are deliberately ignored — their names are reusable. This is the
    friendly 409; the partial unique index on the table is the backstop that makes
    the rule true even under a race this single-user app will not hit.
    """
    statement = select(Service).where(
        Service.archived_at.is_(None),
        func.lower(Service.name) == name.strip().lower(),
    )
    if exclude_id is not None:
        statement = statement.where(Service.id != exclude_id)
    clash = db.session.scalar(statement.limit(1))
    if clash is not None:
        raise conflict(f'A service named "{clash.name}" is already active.')


def _editable_fields(payload: dict) -> dict:
    return {
        "name": payload["name"],
        "category": payload.get("category"),
        "description": payload.get("description"),
        "unit": payload.get("unit") or "job",
        "default_qty_milli": payload.get("default_qty_milli", 1000),
        "rate_paise": payload["rate_paise"],
    }


def _escape_like(value: str) -> str:
    """Escape LIKE metacharacters so a typed `%`/`_` is a literal (§16)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
