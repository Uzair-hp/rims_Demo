"""
Ruchita Interiors — API error types and response envelopes.

§9.1 fixes one envelope for every outcome, so the frontend client never has to
branch on response shape:

    {"data": {...}}
    {"error": {"code": ..., "message": ..., "details": [...]}}

`ApiError` is the single exception type raised by routes, services and schemas.
The app factory turns it into a response, so raising it is always enough - no
route needs its own try/except.
"""

from __future__ import annotations

from typing import Any, Iterable

# §9.1 code -> default HTTP status.
CODE_STATUS: dict[str, int] = {
    "VALIDATION_ERROR": 422,
    "BUSINESS_RULE": 422,
    "UNAUTHENTICATED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "METHOD_NOT_ALLOWED": 405,
    "CONFLICT": 409,
    "RATE_LIMITED": 429,
    "INTERNAL": 500,
}


class ApiError(Exception):
    """
    An error that already knows how it should be rendered.

    The message is what the client shows the user, so it must be safe to display:
    no stack traces, no SQL, and no hint that an account exists.
    """

    def __init__(
        self,
        code: str,
        message: str,
        details: Iterable[dict[str, Any]] | None = None,
        status: int | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = list(details or [])
        self.status = status or CODE_STATUS.get(code, 500)
        # Seconds for the `Retry-After` header. `None` on every other error, so
        # the factory can test it rather than special-casing the code.
        self.retry_after = retry_after

    def to_dict(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


def validation_error(message: str, details: Iterable[dict[str, Any]] | None = None) -> ApiError:
    return ApiError("VALIDATION_ERROR", message, details)


def field_error(field: str, message: str) -> ApiError:
    """A single-field validation failure, shaped for inline form display."""
    return ApiError("VALIDATION_ERROR", message, [{"field": field, "message": message}])


def unauthenticated(message: str = "Please sign in to continue.") -> ApiError:
    return ApiError("UNAUTHENTICATED", message)


def forbidden(message: str = "You do not have access to that.") -> ApiError:
    return ApiError("FORBIDDEN", message)


def not_found(message: str = "That record could not be found.") -> ApiError:
    return ApiError("NOT_FOUND", message)


def conflict(message: str, details: Iterable[dict[str, Any]] | None = None) -> ApiError:
    """A request that contradicts the current state (409), e.g. restore an active client."""
    return ApiError("CONFLICT", message, details)


def business_rule(message: str, details: Iterable[dict[str, Any]] | None = None) -> ApiError:
    """A domain rule that is not a field error (422), e.g. "send with no items"."""
    return ApiError("BUSINESS_RULE", message, details)


def rate_limited(retry_after_seconds: int) -> ApiError:
    """
    Too many attempts (429).

    `retry_after_seconds` is carried on the error rather than discarded, because
    a 429 without it tells a well-behaved client nothing except that it was
    rejected: RFC 6585 defines `Retry-After` for exactly this status, and a client
    that honours it backs off instead of retrying into the same wall. The app
    factory reads it off the error to set the header.
    """
    return ApiError(
        "RATE_LIMITED",
        "Too many sign-in attempts. Please wait and try again.",
        retry_after=retry_after_seconds,
    )


def success(data: Any, status: int = 200):
    """
    Build a success response.

    Returns the Flask `Response` object, not a `(body, status)` tuple. Endpoints
    attach cookies to it afterwards, and a tuple has no `set_cookie`. The status
    is applied here instead, so a caller cannot forget it.
    """
    from flask import jsonify

    response = jsonify({"data": data})
    response.status_code = status
    return response
