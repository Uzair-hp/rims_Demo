"""
Ruchita Interiors — seed commands.

`seed_admin.py` (Phase 2) creates the owner account. `seed_defaults.py`
(Phase 3) inserts the settings row, starter terms and catalogue lists. Both are
registered as `flask` CLI commands by the app factory and both refuse to run
before `flask db upgrade` (§8.1: Alembic owns DDL).
"""
