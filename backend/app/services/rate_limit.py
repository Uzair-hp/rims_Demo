"""
Ruchita Interiors — in-memory login rate limiter.

§16 specifies 5 attempts per 5 minutes per IP + email, in memory, because this is
a single-process, single-user application. There is nothing to share between
workers, so a Redis or file-backed store would be complexity without a purpose.

Counting *failures* rather than attempts is a deliberate deviation from §16, which
says "attempts". A user who mistypes once and then signs in correctly should not be
penalised, and a locked-out owner has no self-service recovery in this system. The
window still bounds brute force: every failed guess consumes budget, and only a
success clears it.

The clock is injectable so tests can assert the window boundary exactly instead of
sleeping, and the state is keyed per-limiter so tests cannot leak counters into one
another.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from flask import current_app, request

from app.utils.errors import rate_limited


def _config(key: str):
    try:
        return current_app.config[key]
    except RuntimeError:  # pragma: no cover - only outside an app context
        from app.config.settings import settings

        return getattr(settings, key)


@dataclass
class LoginRateLimiter:
    """
    Fixed-window counter keyed by `(ip, email)`.

    A fixed window is the right shape for this limit: it is trivially predictable
    and cannot be starved, which matters more here than the fairness of a sliding
    window. The trade-off is a small burst across the boundary, which for 5
    attempts in 5 minutes is not a practical concern for a single owner.
    """

    max_attempts: int = 5
    window_seconds: int = 300
    clock: Callable[[], float] = time.monotonic
    _failures: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def _prune(self, bucket: str, now: float) -> list[float]:
        """Drop timestamps that have aged out of the window."""
        entries = self._failures.get(bucket, [])
        fresh = [ts for ts in entries if now - ts < self.window_seconds]
        if fresh:
            self._failures[bucket] = fresh
        else:
            self._failures.pop(bucket, None)
        return fresh

    def is_blocked(self, ip: str, email: str) -> bool:
        now = self.clock()
        bucket = self._key(ip, email)
        with self._lock:
            return len(self._prune(bucket, now)) >= self.max_attempts

    def seconds_until_available(self, ip: str, email: str) -> int:
        """Seconds until the oldest failure ages out. At least 1, so it is usable as Retry-After."""
        now = self.clock()
        bucket = self._key(ip, email)
        with self._lock:
            entries = self._prune(bucket, now)
            if not entries:
                return 0
            oldest = min(entries)
            return max(1, int(self.window_seconds - (now - oldest)) + 1)

    def record_failure(self, ip: str, email: str) -> None:
        now = self.clock()
        bucket = self._key(ip, email)
        with self._lock:
            self._failures.setdefault(bucket, []).append(now)

    def record_success(self, ip: str, email: str) -> None:
        """A correct password clears the history for that identity."""
        with self._lock:
            self._failures.pop(self._key(ip, email), None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()

    @staticmethod
    def _key(ip: str, email: str) -> str:
        # Lower-cased email so casing variants cannot each get their own budget.
        return f"{ip}|{email.strip().lower()}"


_limiter = LoginRateLimiter()


def get_limiter() -> LoginRateLimiter:
    """
    The process-wide limiter, configured from the current app on first use.

    Configuration is applied here rather than at import time so that a test app
    with a smaller limit gets a real, separate budget instead of inheriting the
    development default.
    """
    _limiter.max_attempts = _config("LOGIN_RATE_LIMIT_MAX_ATTEMPTS")
    _limiter.window_seconds = _config("LOGIN_RATE_LIMIT_WINDOW_SECONDS")
    return _limiter


def client_ip() -> str:
    """
    Client address for rate-limit keying.

    `X-Forwarded-For` is ignored unless `TRUST_PROXY_HEADERS` is on, because the
    header is trivially spoofable: honouring it in front of no proxy would let an
    attacker send a fresh fake IP with every guess and defeat the limit entirely.

    When it is on, the rightmost `TRUSTED_PROXY_COUNT` entries are proxy-added and
    the one before them is the real client. Anything with too few entries falls back
    to the peer address rather than guessing.
    """
    peer = request.remote_addr or "unknown"

    if not _config("TRUST_PROXY_HEADERS"):
        return peer

    forwarded = request.headers.get("X-Forwarded-For", "")
    if not forwarded:
        return peer

    candidates = [part.strip() for part in forwarded.split(",") if part.strip()]
    trusted_count = _config("TRUSTED_PROXY_COUNT")
    if len(candidates) <= trusted_count:
        # Not enough hops to identify the client; the peer is all we know.
        return peer
    return candidates[-(trusted_count + 1)]


def enforce_login_rate_limit(email: str) -> None:
    """
    Refuse the attempt if this `(ip, email)` is over budget.

    Raises the shared `rate_limited()` error rather than constructing an
    `ApiError` inline, so the 429 envelope has exactly one producer. The wait is
    passed through to become the `Retry-After` header.
    """
    limiter = get_limiter()
    ip = client_ip()
    if limiter.is_blocked(ip, email):
        raise rate_limited(limiter.seconds_until_available(ip, email))


def reset_rate_limit() -> None:
    """Clear all counters. Used by tests and by the seed CLI."""
    _limiter.reset()
