"""
Ruchita Interiors — API blueprint registry.

Routes are grouped under `/api/v1` and always answer with the same envelope
(PLAN §9.1): `{"data": ...}` on success, `{"error": {...}}` on failure.

`health` is the only blueprint that is public. Every other blueprint registers its
endpoints behind `@login_required`, so access control is applied where the routes
are declared rather than in one place that new routes can forget (R9).
"""

from flask import Blueprint

from app.api.auth import auth_bp
from app.api.clients import clients_bp
from app.api.health import health_bp
from app.api.invoices import invoices_bp
from app.api.quotations import quotations_bp
from app.api.settings import settings_bp
from app.api.uploads import uploads_bp

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")
api_bp.register_blueprint(health_bp)
api_bp.register_blueprint(auth_bp)
api_bp.register_blueprint(clients_bp)
api_bp.register_blueprint(quotations_bp)
api_bp.register_blueprint(invoices_bp)
api_bp.register_blueprint(settings_bp)
api_bp.register_blueprint(uploads_bp)
