"""
Ruchita Interiors — settings endpoints (placeholder).

The settings blueprint is referenced by the API registry (`app/api/__init__.py`)
but its endpoints belong to a later phase (the business-settings row, terms and
catalogue lists seeded by `flask seed-defaults`). This module exists so the app
factory can boot; it registers the blueprint with no routes yet.

When the real endpoints land they go here, each behind `@login_required` per the
registry's access-control convention (R9).
"""

from __future__ import annotations

from flask import Blueprint

settings_bp = Blueprint("settings", __name__, url_prefix="/settings")
