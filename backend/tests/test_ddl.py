"""
Unit tests for the SQLite DDL text surgery used by two migrations.

`app/utils/ddl.py` exists because SQLite cannot `ALTER` a constraint, so a
constraint change on a table that other tables reference has to be done by
editing the table's own DDL and replaying it. The hard part is nested
parentheses: the constraints in this schema contain `IN ('a','b','c')`, so
anything that matches a constraint with `[^)]*` truncates it mid-way and emits
unbalanced DDL. These tests pin the paren counting against exactly that.
"""

from __future__ import annotations

from app.utils.ddl import (
    append_table_constraint,
    strip_inline_column,
    strip_table_constraint,
)


# The DDL `b8d5f0e2c7a1` produces: the column is last, with an inline CHECK whose
# body contains a nested `IN (...)`.
INVOICES_WITH_ANONYMOUS_CHECK = (
    "CREATE TABLE invoices (\n"
    "\tid INTEGER NOT NULL, \n"
    "\tnumber VARCHAR(32) NOT NULL, \n"
    "\tstatus VARCHAR(16) NOT NULL DEFAULT 'draft', \n"
    "\tpayment_method VARCHAR(16) CHECK (payment_method IS NULL OR "
    "payment_method IN ('upi','bank_transfer','cash')), \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tCONSTRAINT ck_invoices_status CHECK (status IN "
    "('draft','issued','cancelled')),\n"
    "\tPRIMARY KEY (id)\n"
    ")"
)

# The same after `c3d7e9f1a2b4` gives the CHECK a name. `payment_method` is the
# last column, and the named constraint is the last table-level entry, so both
# of strip's "remove the comma on the other side" branches are exercised here.
INVOICES_WITH_NAMED_CHECK = (
    "CREATE TABLE invoices (\n"
    "\tid INTEGER NOT NULL, \n"
    "\tnumber VARCHAR(32) NOT NULL, \n"
    "\tstatus VARCHAR(16) NOT NULL DEFAULT 'draft', \n"
    "\tpayment_method VARCHAR(16), \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tPRIMARY KEY (id), \n"
    "\tCONSTRAINT ck_invoices_status CHECK (status IN "
    "('draft','issued','cancelled')), \n"
    "\tCONSTRAINT ck_invoices_payment_method CHECK (payment_method IS NULL OR "
    "payment_method IN ('upi','bank_transfer','cash'))\n"
    ")"
)


def test_strip_inline_column_removes_the_check_with_the_column():
    out = strip_inline_column(INVOICES_WITH_ANONYMOUS_CHECK, "payment_method")
    assert "payment_method" not in out
    # Everything else survives untouched.
    for fragment in ("id INTEGER NOT NULL", "number VARCHAR(32)", "created_at DATETIME NOT NULL",
                     "ck_invoices_status", "PRIMARY KEY (id)"):
        assert fragment in out, fragment


def test_strip_inline_column_handles_nested_parentheses():
    """The regression this whole module exists for.

    A regex like `CHECK \\([^)]*\\)` stops at the first `)`, which here is the
    one closing `IN (`, and leaves `,'bank_transfer','cash'))` behind - DDL with
    an unbalanced paren that fails with `near ")": syntax error`.
    """
    out = strip_inline_column(INVOICES_WITH_ANONYMOUS_CHECK, "payment_method")
    assert "bank_transfer" not in out
    assert out.count("(") == out.count(")")


def test_strip_inline_column_middle_of_the_list_keeps_the_neighbours():
    ddl = (
        "CREATE TABLE t (\n"
        "\ta INTEGER NOT NULL, \n"
        "\tb VARCHAR(10) NOT NULL, \n"
        "\tc INTEGER NOT NULL, \n"
        "\tPRIMARY KEY (id)\n"
        ")"
    )
    out = strip_inline_column(ddl, "b")
    assert "b VARCHAR" not in out
    assert "a INTEGER NOT NULL" in out
    assert "c INTEGER NOT NULL" in out
    # No doubled or orphaned comma.
    assert ", ," not in out
    assert out.count("(") == out.count(")")


def test_strip_inline_column_last_column_keeps_the_list_terminated():
    ddl = "CREATE TABLE t (a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY (id))"
    out = strip_inline_column(ddl, "b")
    assert out == "CREATE TABLE t (a INTEGER NOT NULL, PRIMARY KEY (id))"


def test_strip_inline_column_only_column():
    ddl = "CREATE TABLE t (a INTEGER NOT NULL)"
    out = strip_inline_column(ddl, "a")
    assert out == "CREATE TABLE t ()"


def test_strip_inline_column_is_a_no_op_for_an_absent_column():
    """Callers rely on this to detect a schema change and fail loudly."""
    assert strip_inline_column(INVOICES_WITH_ANONYMOUS_CHECK, "nonexistent") == INVOICES_WITH_ANONYMOUS_CHECK


def test_strip_inline_column_ignores_a_column_named_inside_a_constraint():
    """A CHECK mentioning the name must not be mistaken for the column."""
    ddl = (
        "CREATE TABLE t (\n"
        "\tpayment_method VARCHAR(16), \n"
        "\tCONSTRAINT ck_x CHECK (payment_method IS NOT NULL)\n"
        ")"
    )
    out = strip_inline_column(ddl, "payment_method")
    assert "payment_method VARCHAR(16)" not in out
    # The constraint that references it is left alone - removing it is a separate,
    # explicit decision, not a side effect of removing the column.
    assert "ck_x" in out
    assert out.count("(") == out.count(")")


def test_strip_inline_column_ignores_a_quoted_paren():
    """A `)` inside a string literal must not be read as a closing paren."""
    ddl = "CREATE TABLE t (a VARCHAR(9) DEFAULT ')', b INTEGER NOT NULL)"
    out = strip_inline_column(ddl, "b")
    assert "')'" in out
    assert "DEFAULT" in out
    assert "b INTEGER" not in out


def test_append_table_constraint_lands_inside_the_closing_paren():
    out = append_table_constraint(
        "CREATE TABLE t (a INTEGER NOT NULL, PRIMARY KEY (id))",
        "CONSTRAINT ck_a CHECK (a > 0)",
    )
    assert out == (
        "CREATE TABLE t (a INTEGER NOT NULL, PRIMARY KEY (id), "
        "CONSTRAINT ck_a CHECK (a > 0))"
    )


def test_append_table_constraint_keeps_nested_parens_intact():
    out = append_table_constraint(
        "CREATE TABLE t (a VARCHAR(4), PRIMARY KEY (id))",
        "CONSTRAINT ck_a CHECK (a IS NULL OR a IN ('x','y'))",
    )
    assert out.count("(") == out.count(")")
    assert "'x','y'" in out


def test_strip_table_constraint_removes_it_and_its_comma():
    out = strip_table_constraint(INVOICES_WITH_NAMED_CHECK, "ck_invoices_payment_method")
    assert "ck_invoices_payment_method" not in out
    assert "ck_invoices_status" in out
    assert "PRIMARY KEY (id)" in out
    assert ", ," not in out
    assert out.count("(") == out.count(")")


def test_strip_table_constraint_is_a_no_op_for_an_absent_name():
    assert strip_table_constraint(INVOICES_WITH_NAMED_CHECK, "ck_nope") == INVOICES_WITH_NAMED_CHECK


def test_naming_then_stripping_round_trips_to_the_original_shape():
    """
    The real round trip the two migrations perform:

        b8d5 upgrade  -> anonymous inline CHECK
        c3d7 upgrade  -> same CHECK, named
        b8d5 downgrade -> column and CHECK both gone

    The result must match the pre-`b8d5` DDL, or the cycle is lossy.
    """
    base = "CREATE TABLE invoices (\n\tid INTEGER NOT NULL, \n\tnumber VARCHAR(32) NOT NULL, \n\tstatus VARCHAR(16) NOT NULL DEFAULT 'draft', \n\tcreated_at DATETIME NOT NULL, \n\tCONSTRAINT ck_invoices_status CHECK (status IN ('draft','issued','cancelled')),\n\tPRIMARY KEY (id)\n)"

    named = append_table_constraint(
        strip_inline_column(base, "__absent__"),
        "CONSTRAINT ck_invoices_payment_method CHECK (payment_method IS NULL OR "
        "payment_method IN ('upi','bank_transfer','cash'))",
    )
    assert "payment_method VARCHAR(16)" not in named  # base has no column

    back = strip_table_constraint(named, "ck_invoices_payment_method")
    back = strip_inline_column(back, "payment_method")

    def normalise(ddl: str) -> str:
        return " ".join(ddl.replace("\n", " ").split())

    assert normalise(back) == normalise(base)
