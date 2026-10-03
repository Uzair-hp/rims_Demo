#!/usr/bin/env python
"""
Throwaway SAMPLE / DEMO data for Ruchita Interiors — DEV ONLY.

This is NOT a real seeder. `seed-admin` and `seed-defaults` create the owner
account and the settings / terms / catalogue the app needs to run; this script
fabricates *business* records — clients, a few catalogue services, quotations,
invoices and payments — so the Dashboard and its charts have something to show
during development.

It is deliberately isolated and resettable:

    python scripts/seed_sample_data.py          # wipe sample tables, then insert
    python scripts/seed_sample_data.py --clear   # wipe only, insert nothing

"Wipe" clears every row of the business tables (payments, invoice_items,
invoices, quotation_items, quotations, services, clients) and resets the
numbering counters. It leaves users, company_settings and terms untouched. These
tables hold no real data yet; if that ever changes, do not run this against them.

Refuses to run when the app is configured for production (IS_PRODUCTION), so a
stray invocation can never delete live records.
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta

# Make the backend package importable when run as `python scripts/seed_sample_data.py`.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.extensions.database import db  # noqa: E402
from app.models import (  # noqa: E402
    Client,
    Invoice,
    InvoiceItem,
    Payment,
    Quotation,
    QuotationItem,
    Service,
    User,
)
from app.services.calculations import calculate_line_total, calculate_totals  # noqa: E402
from app.services.numbering import allocate_number  # noqa: E402

# Today is the reference point for every relative date below, so the data always
# lands in the Dashboard's live 30-day and 12-month windows no matter when it runs.
TODAY = date.today()
YEAR = TODAY.year

GST_BP = 1800  # 18% — the standard rate these documents quote.
TERMS = (
    "50% advance on confirmation, 40% on material procurement, balance 10% on "
    "handover. Prices valid for 30 days. Taxes as applicable."
)

def rupees(amount) -> int:
    """Whole/decimal rupees -> integer paise (the unit every money column stores)."""
    return int(round(amount * 100))


def qty(units) -> int:
    """Quantity in units -> milli-units (the integer quantity line items store)."""
    return int(round(units * 1000))


def at_noon(d: date) -> datetime:
    """A date as a midday timestamp, so created_at ordering matches the dates."""
    return datetime(d.year, d.month, d.day, 12, 0, 0)


def days_ago(n: int) -> date:
    return TODAY - timedelta(days=n)


def clear_sample_data() -> None:
    """
    Delete every business row, children first so the RESTRICT foreign keys never
    block, then reset the numbering counters so a re-seed reproduces the same
    document numbers. Users, company settings and terms are left alone.
    """
    for model in (Payment, InvoiceItem, Invoice, QuotationItem, Quotation, Service, Client):
        db.session.query(model).delete(synchronize_session=False)
    db.session.execute(db.text("DELETE FROM numbering_counters"))
    db.session.commit()


def build_quotation(*, client, qdate, status, lines, created_by,
                    discount_type="percent", discount_bp=0, discount_fixed_paise=None,
                    notes=None):
    """
    Build one Quotation plus its items, with totals computed by the real
    calculation service so the cached columns match what the app would store.

    `lines` is a list of (name, category, unit, qty_milli, rate_paise, service).
    """
    items, line_totals = [], []
    for position, (name, category, unit, qty_milli, rate_paise, service) in enumerate(lines):
        line_total = calculate_line_total(qty_milli, rate_paise).line_total_paise
        line_totals.append(line_total)
        items.append(QuotationItem(
            position=position, name=name, category=category, unit=unit,
            qty_milli=qty_milli, rate_paise=rate_paise, line_total_paise=line_total,
            service_id=service.id if service else None,
            catalog_rate_paise=service.rate_paise if service else None,
        ))

    totals = calculate_totals(line_totals, discount_type, discount_bp,
                              discount_fixed_paise, GST_BP, 0)
    allocation = allocate_number("quotation", YEAR)
    return Quotation(
        number=allocation.number, year=YEAR, client_id=client.id,
        client_snapshot=client.to_snapshot(), quotation_date=qdate,
        valid_until=qdate + timedelta(days=30), status=status,
        discount_type=discount_type,
        discount_bp=discount_bp if discount_type == "percent" else None,
        discount_fixed_paise=discount_fixed_paise if discount_type == "fixed" else None,
        gst_bp=GST_BP, other_charges_label="Other Charges", other_charges_paise=0,
        subtotal_paise=totals.subtotal_paise, discount_paise=totals.discount_paise,
        gst_paise=totals.gst_paise, grand_total_paise=totals.grand_total_paise,
        terms_text=TERMS, notes=notes, created_by=created_by, items=items,
        created_at=at_noon(qdate), updated_at=at_noon(qdate),
    )


def build_invoice(*, quotation, client, issue_date, due_date, created_by,
                  payment_method=None):
    """
    Build an issued Invoice from a converted quotation, mirroring its items and
    cached totals the way Phase 7 conversion does. The caller flips the source
    quotation's status to 'converted'.
    """
    items = [
        InvoiceItem(
            position=it.position, name=it.name, category=it.category, unit=it.unit,
            qty_milli=it.qty_milli, rate_paise=it.rate_paise,
            line_total_paise=it.line_total_paise,
            service_id=it.service_id, catalog_rate_paise=it.catalog_rate_paise,
        )
        for it in quotation.items
    ]
    allocation = allocate_number("invoice", YEAR)
    return Invoice(
        number=allocation.number, year=YEAR, quotation_id=quotation.id,
        client_id=client.id, client_snapshot=client.to_snapshot(),
        issue_date=issue_date, due_date=due_date, status="issued",
        discount_type=quotation.discount_type, discount_bp=quotation.discount_bp,
        discount_fixed_paise=quotation.discount_fixed_paise, gst_bp=quotation.gst_bp,
        other_charges_label=quotation.other_charges_label,
        other_charges_paise=quotation.other_charges_paise,
        subtotal_paise=quotation.subtotal_paise, discount_paise=quotation.discount_paise,
        gst_paise=quotation.gst_paise, grand_total_paise=quotation.grand_total_paise,
        terms_text=quotation.terms_text, payment_method=payment_method,
        signatory_name="Ruchita Interiors", notes=None, created_by=created_by,
        items=items, created_at=at_noon(issue_date), updated_at=at_noon(issue_date),
    )


def seed_sample_data() -> dict:
    owner = db.session.query(User).order_by(User.id).first()
    if owner is None:
        raise SystemExit("No owner account found. Run `flask seed-admin` first.")
    created_by = owner.id

    # --- Catalogue services (rate card) ------------------------------------
    services = {
        "kitchen": Service(name="Modular Kitchen Design", category="Kitchen",
                           unit="project", default_qty_milli=qty(1), rate_paise=rupees(250000),
                           description="L-shaped modular kitchen with soft-close hardware and quartz counters."),
        "ceiling": Service(name="False Ceiling & Lighting", category="Ceiling",
                           unit="sqft", default_qty_milli=qty(1), rate_paise=rupees(180),
                           description="Gypsum false ceiling with cove and profile lighting."),
        "turnkey": Service(name="Full Home Turnkey", category="Turnkey",
                           unit="project", default_qty_milli=qty(1), rate_paise=rupees(1800000),
                           description="End-to-end turnkey interior execution and handover."),
        "wardrobe": Service(name="Wardrobe & Storage", category="Joinery",
                            unit="sqft", default_qty_milli=qty(1), rate_paise=rupees(1400),
                            description="Floor-to-ceiling wardrobes with laminate and loft storage."),
        "consult": Service(name="Interior Design Consultation", category="Design",
                           unit="hour", default_qty_milli=qty(1), rate_paise=rupees(2500),
                           description="On-site and studio consultation, mood boards and layouts."),
    }
    db.session.add_all(services.values())
    db.session.flush()

    # --- Clients (luxury apartment / villa owners) -------------------------
    clients = {
        "kapoor": Client(name="Aarav & Meera Kapoor", phone="+91 98200 11234",
                         email="aarav.kapoor@example.in",
                         address="A-2104, Oberoi Sky Heights, Prabhadevi, Mumbai 400025",
                         project_address="Sea-facing 4BHK, 24th floor",
                         notes="Prefers muted palettes and imported Italian marble."),
        "malhotra": Client(name="Rajesh Malhotra", phone="+91 99300 44567",
                           email="rajesh.malhotra@example.in",
                           address="Villa 7, Amby Valley Road, Lonavala 410401",
                           project_address="Hillside weekend villa, 6BHK with home theatre",
                           gstin="27ABCDE1234F1Z5",
                           notes="Wants full smart-home integration."),
        "deshpande": Client(name="Shalini Deshpande", phone="+91 98220 77890",
                            email="shalini.d@example.in",
                            address="Penthouse 1801, Trump Towers, Koregaon Park, Pune 411001",
                            project_address="Duplex penthouse, 5BHK + terrace garden",
                            notes="Art collector — needs gallery lighting in living areas."),
        "rao": Client(name="Vikram & Anjali Rao", phone="+91 99860 33221",
                      email="vikram.rao@example.in",
                      address="Villa 12, Prestige Golfshire, Whitefield, Bangalore 560066",
                      project_address="Independent villa, 5BHK turnkey",
                      gstin="29PQRSX6789K2Z1",
                      notes="Turnkey handover expected before Diwali."),
    }
    db.session.add_all(clients.values())
    db.session.flush()

    # --- Quotations: draft, sent, approved, and three converted ------------
    # The three converted quotations each become an invoice below, so the set
    # covers every pipeline status the Dashboard charts break out.
    s = services
    c = clients

    q_draft = build_quotation(
        client=c["kapoor"], qdate=days_ago(3), status="draft", created_by=created_by,
        discount_type="percent", discount_bp=500,
        notes="Initial concept estimate; awaiting finalised layout.",
        lines=[
            ("Modular Kitchen Design", "Kitchen", "project", qty(1), rupees(250000), s["kitchen"]),
            ("False Ceiling & Lighting", "Ceiling", "sqft", qty(850), rupees(180), s["ceiling"]),
        ],
    )
    q_sent = build_quotation(
        client=c["malhotra"], qdate=days_ago(12), status="sent", created_by=created_by,
        discount_type="percent", discount_bp=300,
        lines=[
            ("Full Home Turnkey", "Turnkey", "project", qty(1), rupees(1800000), s["turnkey"]),
            ("Wardrobe & Storage", "Joinery", "sqft", qty(600), rupees(1400), s["wardrobe"]),
        ],
    )
    q_approved = build_quotation(
        client=c["deshpande"], qdate=days_ago(22), status="approved", created_by=created_by,
        discount_type="fixed", discount_fixed_paise=rupees(50000),
        notes="Client has accepted; invoice to follow after site measurement.",
        lines=[
            ("Interior Design Consultation", "Design", "hour", qty(40), rupees(2500), s["consult"]),
            ("False Ceiling & Lighting", "Ceiling", "sqft", qty(1200), rupees(180), s["ceiling"]),
            ("Wardrobe & Storage", "Joinery", "sqft", qty(300), rupees(1400), s["wardrobe"]),
        ],
    )
    q_paid = build_quotation(
        client=c["rao"], qdate=days_ago(43), status="converted", created_by=created_by,
        lines=[("Full Home Turnkey", "Turnkey", "project", qty(1), rupees(1800000), s["turnkey"])],
    )
    q_partial = build_quotation(
        client=c["kapoor"], qdate=days_ago(30), status="converted", created_by=created_by,
        discount_type="percent", discount_bp=200,
        lines=[
            ("Wardrobe & Storage", "Joinery", "sqft", qty(500), rupees(1400), s["wardrobe"]),
            ("False Ceiling & Lighting", "Ceiling", "sqft", qty(600), rupees(180), s["ceiling"]),
        ],
    )
    q_overdue = build_quotation(
        client=c["malhotra"], qdate=days_ago(70), status="converted", created_by=created_by,
        lines=[
            ("Modular Kitchen Design", "Kitchen", "project", qty(1), rupees(250000), s["kitchen"]),
            ("Wardrobe & Storage", "Joinery", "sqft", qty(350), rupees(1400), s["wardrobe"]),
        ],
    )
    quotations = [q_draft, q_sent, q_approved, q_paid, q_partial, q_overdue]
    db.session.add_all(quotations)
    db.session.flush()

    # --- Invoices from the converted quotations ----------------------------
    # Due dates are future for the paid/partial pair and past for the overdue
    # one, so the invoice list derives Paid / Partially paid / Overdue correctly.
    inv_paid = build_invoice(quotation=q_paid, client=c["rao"],
                             issue_date=days_ago(28), due_date=days_ago(-2),
                             payment_method="bank_transfer", created_by=created_by)
    inv_partial = build_invoice(quotation=q_partial, client=c["kapoor"],
                                issue_date=days_ago(20), due_date=days_ago(-10),
                                payment_method="upi", created_by=created_by)
    inv_overdue = build_invoice(quotation=q_overdue, client=c["malhotra"],
                                issue_date=days_ago(58), due_date=days_ago(16),
                                payment_method="upi", created_by=created_by)
    db.session.add_all([inv_paid, inv_partial, inv_overdue])
    db.session.flush()

    # --- Payments ----------------------------------------------------------
    # inv_paid: two instalments summing to the grand total -> "Paid".
    # inv_partial: one instalment (~45%) -> "Partially paid", balance due.
    # inv_overdue: nothing paid and past due -> "Overdue".
    g_paid = inv_paid.grand_total_paise
    first = g_paid // 2
    g_partial = inv_partial.grand_total_paise
    payments = [
        Payment(invoice_id=inv_paid.id, amount_paise=first, paid_on=days_ago(22),
                method="bank_transfer", reference="NEFT/AX2291", created_by=created_by),
        Payment(invoice_id=inv_paid.id, amount_paise=g_paid - first, paid_on=days_ago(10),
                method="upi", reference="UPI/4455", created_by=created_by),
        Payment(invoice_id=inv_partial.id, amount_paise=(g_partial * 45) // 100,
                paid_on=days_ago(12), method="upi", reference="UPI/7781",
                created_by=created_by),
    ]
    db.session.add_all(payments)
    db.session.commit()

    return {
        "services": len(services),
        "clients": len(clients),
        "quotations": len(quotations),
        "invoices": 3,
        "payments": len(payments),
    }


def main() -> None:
    clear_only = "--clear" in sys.argv[1:]

    app = create_app()
    with app.app_context():
        if app.config.get("IS_PRODUCTION"):
            raise SystemExit("Refusing to run: the app is configured for production.")

        clear_sample_data()
        if clear_only:
            print("Sample data cleared. Business tables are empty.")
            return

        counts = seed_sample_data()
        print("Sample data seeded:")
        for label in ("services", "clients", "quotations", "invoices", "payments"):
            print(f"  {counts[label]:>2} {label}")
        print("\nQuotation statuses: 1 draft, 1 sent, 1 approved, 3 converted.")
        print("Invoices: 1 paid, 1 partially paid (balance due), 1 overdue.")
        print("Re-run with --clear to wipe, or without flags to reset and reseed.")


if __name__ == "__main__":
    main()








