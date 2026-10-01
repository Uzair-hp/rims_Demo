"""
Ruchita Interiors — request-level guards.

`@login_required` is the server-side half of authentication. §16 is explicit that
the backend never trusts the frontend: route guards in React are a UX convenience,
while this decorator is what actually makes unauthenticated access impossible
(R9). A new endpoint is protected by writing the decorator, not by remembering to
add it somewhere central.

`@owner_required` is the authorization half, and it exists because "there is only
ever one account" is a *convention*, not an invariant the database or the code
enforces. `User.role` is a real column; before this guard, nothing read it. So the
moment a second row appeared — by a seed script, a restored backup, a migration,
or a future team feature — that account was instantly owner-equivalent and could
rewrite the bank account number, the UPI ID and the tax defaults, which is the
whole of where customer money is sent.

Enforcing it now means the blast radius of a second account is decided by the
schema rather than discovered during an incident. See `docs/phases.md` §1.3 for why
multi-user is still out of scope: this is a guard on an existing column, not a
roles feature.
"""

from __future__ import annotations

from functools import wraps

from flask import g

from app.services.auth import load_current_user
from app.utils.errors import forbidden, unauthenticated

#: The one role that may change company-wide configuration. Every account created
#: by `flask seed-admin` and `AUTO_SEED_ADMIN` gets it.
OWNER_ROLE = "owner"


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


def owner_required(view):
    """
    Reject the request unless the authenticated user is the owner.

    Always applied *under* `@login_required` (i.e. listed after it, so it is the
    inner wrapper), so an unauthenticated request still gets a 401 rather than a
    403 — telling an anonymous caller "you are not the owner" would confirm that
    the endpoint exists and that an owner does.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        user = getattr(g, "current_user", None)
        if user is None:
            # `@login_required` is missing, or was ordered above this one.
            raise unauthenticated()
        if (getattr(user, "role", None) or "").strip().lower() != OWNER_ROLE:
            raise forbidden("Only the owner can change these settings.")
        return view(*args, **kwargs)

    return wrapper
