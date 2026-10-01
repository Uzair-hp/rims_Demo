"""
SQLite DDL text surgery for Alembic migrations.

Some schema changes cannot be expressed as an `ALTER`. SQLite has no
`ADD CONSTRAINT`, and a constraint change is a table recreate - which is fine for
a table nothing references and impossible for one that is the target of foreign
keys from elsewhere. For those, the working technique is to read the table's own
DDL out of `sqlite_master`, edit that text, and replay it.

Editing the *existing* DDL rather than retyping it is the point. A hardcoded
`CREATE TABLE` in a migration has to restate every column, default and foreign
key, and silently drops anything a different revision added - a migration that
destroys a column it was never asked to touch. Transforming what is already
there cannot.

The one thing this module exists to get right is **nested parentheses**. The
constraints in this schema contain `IN ('a','b','c')`, so a regex like
`CHECK \([^)]*\)` stops at the first `)` and leaves the tail of the constraint
behind, producing DDL with an unbalanced paren and a `near ")": syntax error` at
the worst possible moment. So paren matching here is done by counting, not by
pattern.
"""

from __future__ import annotations


def strip_inline_column(ddl: str, column: str) -> str:
    """
    Remove one column definition from a `CREATE TABLE` body.

    Matches the column at the top level of the table - not inside a nested
    paren, which is what a `DEFAULT (lower(x))` or a table-level `CHECK` would
    look like - and removes it together with any column-level constraint
    attached to it, up to and including the comma that follows. A trailing comma
    is inserted when the removed column was last, so the remaining list never
    ends in one.

    Returns the DDL unchanged when the column is not present, so callers can
    detect a no-op and fail loudly rather than silently recreating a table
    without the change they meant to make.
    """
    body_start, body_end = _table_body_bounds(ddl)

    for match in _top_level_column_defs(ddl, body_start, body_end):
        if _identifier(ddl, match[0]).lower() == column.lower():
            start, end = match[0], match[1]
            # A definition span ends *at* its terminating comma, so the comma is
            # still there. Consume it plus any whitespace before the next entry.
            # The test has to happen before consuming: a column that is followed
            # by a comma is not the last one, and dropping the preceding comma
            # instead would join its neighbour to whatever precedes it.
            if end < body_end and ddl[end] == ",":
                end += 1
                end = _skip_to_next_entry(ddl, end, body_end)
            else:
                # The column was last: drop the comma that preceded it instead.
                start = _rewind_over(ddl, start, body_start, ", \t\r\n")
                if start > body_start and ddl[start - 1] == ",":
                    start -= 1
            return ddl[:start] + ddl[end:]

    return ddl


def strip_column_constraint(ddl: str, column: str) -> str:
    """
    Remove a column-level constraint (`CHECK (...)` / `NOT NULL` / `DEFAULT ...`)
    from a column definition, keeping the column and its type.

    This is the mirror of `strip_inline_column`: it drops the anonymous inline
    `CHECK` a column was born with while leaving the column in place, so the
    same rule can be re-declared as a named table-level constraint. That is the
    shape change from an unnamed to a named CHECK on an existing column.

    Returns the DDL unchanged when the column has no such constraint, so callers
    can detect a no-op.
    """
    body_start, body_end = _table_body_bounds(ddl)

    for start, end in _top_level_column_defs(ddl, body_start, body_end):
        if _identifier(ddl, start).lower() != column.lower():
            continue
        clause = ddl[start:end]
        for keyword in ("check", "not null", "default", "unique", "references", "collate"):
            # Searched rather than matched at a fixed offset: the constraint
            # follows the type declaration (`VARCHAR(16) CHECK (...)`), and the
            # offset of the type name varies with the column and its quoting.
            index = _top_level_index(clause, keyword)
            if index != -1:
                return ddl[: start + index] + ddl[end:]
        return ddl

    return ddl


def _top_level_index(clause: str, keyword: str) -> int:
    """
    Index of `keyword` in `clause`, ignoring occurrences inside parens or quotes.

    Needed because a constraint body can itself contain the word - a CHECK
    reading `CHECK (default_rate > 0)` must not be mistaken for a `DEFAULT`.
    """
    lowered = clause.lower()
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(clause):
        char = clause[index]
        if quote is not None:
            if char == quote:
                if index + 1 < len(clause) and clause[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif depth == 0 and lowered.startswith(keyword, index):
            return index
        index += 1
    return -1


def index_ddl_for(conn, table: str) -> list[str]:
    """
    The `CREATE INDEX` statements backing `table`, ready to replay.

    A rebuild has to capture these first. Indexes live in `sqlite_master` keyed
    by *table name*, so an `ALTER TABLE ... RENAME` moves them onto the temporary
    name and `DROP TABLE` takes them with it - leaving the rebuilt table with no
    indexes at all, and every later migration or query that assumes one failing
    on `no such index`.

    Auto-indexes (those SQLite creates for a `UNIQUE` constraint) have a `NULL`
    `sql` and are recreated by the table definition itself, so they are skipped.
    """
    rows = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        (table,),
    ).fetchall()
    return [row[0] for row in rows]


def table_column_names(conn, table: str) -> list[str]:
    """Column names of `table`, in declaration order."""
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def append_table_constraint(ddl: str, definition: str) -> str:
    """
    Insert a table-level constraint just inside the closing paren of the body.

    `definition` is the full clause, e.g.
    ``CONSTRAINT ck_x CHECK (x > 0)`` - without a leading comma, which is added
    here so the caller cannot get it subtly wrong in either direction.
    """
    _, body_end = _table_body_bounds(ddl)
    return ddl[:body_end] + ", " + definition + ddl[body_end:]


def strip_table_constraint(ddl: str, name: str) -> str:
    """
    Remove a named table-level constraint, with the comma that joins it.

    Returns the DDL unchanged when no such constraint is named, so callers can
    detect a no-op.
    """
    needle = f"CONSTRAINT {name}"
    index = ddl.upper().find(needle.upper())
    if index == -1:
        return ddl

    end = _end_of_clause(ddl, index)
    if ddl[end : end + 1] == ",":
        # Not the last entry: take the separating comma with it.
        end += 1
    start = _rewind_over(ddl, index, 0, " \t\r\n")
    if start > 0 and ddl[start - 1] == ",":
        # It *was* the last entry, so drop the comma that preceded it instead.
        start -= 1
    return ddl[:start] + ddl[end:]


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------


def _table_body_bounds(ddl: str) -> tuple[int, int]:
    """Return the (start, end) offsets of the paren body of a CREATE TABLE."""
    open_paren = ddl.index("(")
    return open_paren + 1, _matching_paren(ddl, open_paren)


def _matching_paren(ddl: str, open_index: int) -> int:
    """Index of the `)` that closes the `(` at `open_index`, counting nesting.

    Quoted strings are skipped so a `')'` inside a string literal cannot end the
    match early.
    """
    depth = 0
    index = open_index
    quote: str | None = None
    while index < len(ddl):
        char = ddl[index]
        if quote is not None:
            # SQL escapes a quote inside a literal by doubling it.
            if char == quote:
                if index + 1 < len(ddl) and ddl[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise ValueError("unbalanced parentheses in DDL")


def _top_level_column_defs(ddl: str, body_start: int, body_end: int) -> list[tuple[int, int]]:
    """
    Spans of every column definition in the table body.

    A definition starts at the first non-space character of a top-level entry and
    ends at the comma that terminates it (exclusive). A table-level constraint
    clause is not a column and is skipped, so `CONSTRAINT ...` entries are never
    mistaken for one.
    """
    spans: list[tuple[int, int]] = []
    index = body_start
    while index < body_end:
        start = _skip_to_next_entry(ddl, index, body_end)
        if start >= body_end:
            break
        end = _end_of_clause(ddl, start, limit=body_end)
        if ddl[start : start + 10].upper() != "CONSTRAINT ":
            spans.append((start, end))
        index = end + 1 if end < body_end else body_end
    return spans


def _skip_to_next_entry(ddl: str, index: int, limit: int) -> int:
    """Advance past whitespace and separators to the next entry's first char."""
    while index < limit and ddl[index] in ", \t\r\n":
        index += 1
    return index


def _end_of_clause(ddl: str, index: int, limit: int | None = None) -> int:
    """
    End of the clause starting at `index`: the comma that terminates it, or the
    closing paren of the enclosing body.

    Commas inside a nested paren or a quoted string do not terminate the clause -
    the same nesting problem that makes regex unsafe here.
    """
    if limit is None:
        limit = len(ddl)
    depth = 0
    quote: str | None = None
    while index < limit:
        char = ddl[index]
        if quote is not None:
            if char == quote:
                if index + 1 < limit and ddl[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                return index
            depth -= 1
        elif char == "," and depth == 0:
            return index
        index += 1
    return limit


def _rewind_over(ddl: str, index: int, floor: int, chars: str) -> int:
    """Walk `index` backwards over any of `chars`, never past `floor`."""
    while index > floor and ddl[index - 1] in chars:
        index -= 1
    return index


def _identifier(ddl: str, start: int) -> str:
    """The bare identifier at `start`, without quoting."""
    end = start
    while end < len(ddl) and (ddl[end].isalnum() or ddl[end] == "_"):
        end += 1
    return ddl[start:end].strip('"`[]')
