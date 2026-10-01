"""
Ruchita Interiors — normalise stored client phone numbers (FR-C1).

    python scripts/normalize_client_phones.py            # report + fix
    python scripts/normalize_client_phones.py --dry-run  # report only

The client API now stores a phone number as ten bare digits, because that is the
only form in which a duplicate check or a search is meaningful. Existing rows
were written before that rule, so they hold whatever a person typed. This script
brings them into line.

**It never deletes and never invents a number.** A row whose phone cannot be
parsed is left exactly as it is and reported as `id, name, current value`. That
matters because those rows are real clients with real quotations against them,
and a billing history that has quietly lost its customer's phone number is worse
than one still showing a malformed number. Such a client keeps working: they
still appear in lists, in the picker and on their documents. The only thing they
cannot do is be *re-saved* until the number is corrected, which is the
schema's `required=True` doing its job at the only moment a human is present to
fix it.

**Safe to run twice.** The fix is a normalisation, and normalising an already
normalised value is a no-op, so a second run reports zero changes rather than
double-applying anything. A dry run writes nothing at all.

**No migration, deliberately.** `clients.phone` stays a nullable column with no
unique index. Adding `NOT NULL` would fail on the very rows this script reports
rather than fixing them, and a unique index cannot be created while two clients
still share a number — a second failure that would block the deployment for a
reason the owner has to resolve by hand, in the database, at the worst possible
moment. The duplicate check therefore lives in the service layer
(`services/clients.py`), which can name the conflicting client in the error,
and the migration that would enforce it at the column level is deliberately
future work.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

# Run from the repo root, or from anywhere: the backend package lives one level
# up from this file and is not installed.
BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import create_app  # noqa: E402
from app.extensions.database import db  # noqa: E402
from app.models import Client  # noqa: E402
from app.utils.phone import normalize_phone  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args()

    app = create_app()

    with app.app_context():
        rows = db.session.scalars(select(Client).order_by(Client.id)).all()

        fixed: list[tuple[int, str, str, str]] = []
        reported: list[tuple[int, str, str]] = []
        unchanged = 0

        for client in rows:
            current = client.phone
            if not current:
                reported.append((client.id, client.name, "(empty)"))
                continue

            normalized = normalize_phone(current)
            if normalized is None:
                # Left untouched on purpose. See the module docstring.
                reported.append((client.id, client.name, current))
                continue

            if normalized == current:
                unchanged += 1
                continue

            fixed.append((client.id, client.name, current, normalized))
            if not args.dry_run:
                client.phone = normalized

        if fixed and not args.dry_run:
            db.session.commit()
        elif not args.dry_run:
            # Nothing to write, but a rollback-free path: leave the session clean
            # so a read-only run cannot leave a pending transaction behind.
            db.session.rollback()

    prefix = "would normalise" if args.dry_run else "normalised"
    print(f"Scanned {len(rows)} client(s).")
    print(f"  already canonical : {unchanged}")
    print(f"  {prefix:<16}: {len(fixed)}")

    if fixed:
        print()
        print(f"{'id':>4}  {'name':<28} {'before':<20} after")
        for client_id, name, before, after in fixed:
            print(f"{client_id:>4}  {name[:28]:<28} {before[:20]:<20} {after}")

    if reported:
        print()
        print("NEEDS A HUMAN — left exactly as it is, not deleted:")
        print(f"{'id':>4}  {'name':<28} current value")
        for client_id, name, value in reported:
            print(f"{client_id:>4}  {name[:28]:<28} {value}")
        print()
        print(
            "These clients still work and still appear everywhere. They cannot be "
            "re-saved\nuntil the number is corrected, which is the point: fix them "
            "in the app, then\nre-run this script to confirm the report is empty."
        )

    if args.dry_run and fixed:
        print()
        print("Dry run: nothing was written. Re-run without --dry-run to apply.")
    elif not args.dry_run:
        print()
        print("Done. Safe to run again — a normalised number is already canonical.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
