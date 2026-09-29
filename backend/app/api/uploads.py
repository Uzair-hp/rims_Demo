"""
Ruchita Interiors — file upload endpoints (placeholder).

Referenced by the API registry (`app/api/__init__.py`) but the upload handling
(logo and document assets under `backend/uploads/`) is a later-phase concern.
This module exists so the app factory can boot; it registers the blueprint with
no routes yet.

Real endpoints go here behind `@login_required` per the registry convention (R9).
"""

from __future__ import annotations

from flask import Blueprint

uploads_bp = Blueprint("uploads", __name__, url_prefix="/uploads")
