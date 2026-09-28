"""
Ruchita Interiors — request-level guards.

`@login_required` is the server-side half of authentication. §16 is explicit that
the backend never trusts the frontend: route guards in React are a UX convenience,
while this decorator is what actually makes unauthenticated access impossible
(R9). A new endpoint is protected by writing the decorator, not by remembering to
add it somewhere central.
"""

from __future__ import annotations

from functools import wraps

from flask import g

from app.services.auth import load_current_user
from app.utils.errors import unauthenticated


def login_required(view):
    """
    Reject the request unless it carries a valid, unrevoked access token.

    Also blocks deactivated accounts, so `is_active = False` takes effect without
    waiting for a token to expire.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        user = load_current_user()
        if user is None:
            raise unauthenticated()
        g.current_user = user
        return view(*args, **kwargs)

    return wrapper
