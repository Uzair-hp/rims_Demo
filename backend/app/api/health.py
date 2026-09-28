"""
Ruchita Interiors — health endpoint.

`GET /api/v1/health` is the one endpoint that needs no session (PLAN §9.2), which
lets the frontend report API reachability before authentication exists.

It touches no database, so it stays useful as a liveness probe and cannot fail for
Phase 2 reasons.
"""

from flask import Blueprint, jsonify

from app.config.settings import settings

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    return jsonify(
        {
            "data": {
                "status": "ok",
                "service": "ruchita-interiors-api",
                "version": settings.APP_VERSION,
                "phase": settings.PHASE,
            }
        }
    ), 200
