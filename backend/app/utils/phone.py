"""
Ruchita Interiors — Indian mobile number normalisation (§9.2, FR-C1).

One helper, used by the client schema and by the data fixup, so a number the API
accepts is exactly the number the fixup would have written. Anything that decides
whether a phone number is acceptable goes through `normalize_phone`.

**Why the digits are the stored form.** The column is a plain string and the app
is single-country, so a canonical value removes a whole class of bug: "+91 90000
12345", "090000-12345" and "9000012345" are one client, not three, and a
duplicate check or a search cannot miss one because of its punctuation. The
`+91` and the grouping are presentation, applied by the frontend's
`formatPhone()` at the edge, never persisted.

**Why this is not `phone` in the company's own settings.** The company number
on an invoice is a display string, snapshotted onto documents exactly as typed
(`models/client.py:55`), and is not a lookup key. Client phones are.

Rejection is deliberately narrow rather than clever:

- exactly ten digits, after the prefixes below are removed;
- the first digit is 6-9, which is where the Indian mobile ranges start;
- not all ten digits identical (`0000000000`, `9999999999`);
- not a strictly ascending or descending run (`1234567890`, `9876543210`).

Those four rules reject the values that actually appear from typos, CSV imports
and placeholder rows, while accepting every real number. A stricter rule — real
allocated-series tables — would reject valid numbers whenever the telecom
authority issues a new series, and this app has no way to learn about one.
"""

from __future__ import annotations

import re

#: The number of digits in an Indian mobile number, without the country code.
PHONE_DIGITS = 10

#: The message the API returns for any rejected number, verbatim. The frontend
#: matches on the field name rather than this text, but keeping it here means the
#: schema and any future caller cannot word it differently.
PHONE_ERROR = "Enter a valid 10-digit Indian mobile number"

_NON_DIGITS = re.compile(r"\D")

# Prefix candidates, longest first so `91` is not tried before `+91`. Each is
# only stripped when what remains is still a plausible length — a number that is
# genuinely `91` followed by eight digits must not be truncated into a
# different, valid-looking one.
_PREFIXES = ("+91", "91", "0")

#: Ascending / descending runs and their reversals, rejected as obvious filler.
#: Computed by `is_obvious_sequence` below rather than enumerated: a
#: hand-built list of the ten-digit runs is easy to get subtly wrong (an
#: off-by-one in the digit range silently produces a set that misses
#: `1234567890`), and a wrong list here means a placeholder number is accepted
#: as a real one.


def is_obvious_sequence(digits: str) -> bool:
    """
    Whether `digits` is a run of consecutive digits, ascending or descending.

    Covers `1234567890`, `0123456789`, `9876543210` and `0987654321`. The step
    is taken modulo ten so the run may wrap through zero, which is what makes
    `1234567890` count: it ascends 1-9 and then wraps to 0.

    Requires every digit to be distinct, so a merely *repetitive* number is left
    to the all-same check rather than being caught twice, and so a real number
    that happens to be internally patterned is not rejected.
    """
    if len(digits) != PHONE_DIGITS or len(set(digits)) != PHONE_DIGITS:
        return False

    steps = {(int(b) - int(a)) % 10 for a, b in zip(digits, digits[1:])}
    return steps in ({1}, {9})



def digits_only(value: object) -> str:
    """Every digit in `value`, in order, with all other characters removed."""
    if value is None:
        return ""
    return _NON_DIGITS.sub("", str(value))


def _strip_prefix(digits: str) -> str:
    """Remove one leading `+91` / `91` / `0`, but only if the rest still fits."""
    for prefix in _PREFIXES:
        candidate = prefix.lstrip("+")
        if not digits.startswith(candidate):
            continue
        remainder = digits[len(candidate) :]
        if len(remainder) == PHONE_DIGITS:
            return remainder
    return digits


def normalize_phone(value: object) -> str | None:
    """
    Reduce a phone number to its ten stored digits, or `None` if it is not valid.

    Accepts anything a person might paste or type: `+91 90000 12345`,
    `090000-12345`, `9000012345`. Returns `None` — never a partially-cleaned
    string — so a caller cannot mistake a rejected number for a usable one.
    """
    digits = digits_only(value)
    if not digits:
        return None

    digits = _strip_prefix(digits)

    if len(digits) != PHONE_DIGITS:
        return None
    if digits[0] not in "6789":
        return None
    if len(set(digits)) == 1:
        return None
    if is_obvious_sequence(digits):
        return None
    return digits


def is_valid_phone(value: object) -> bool:
    """Whether `value` is a phone number this app accepts."""
    return normalize_phone(value) is not None


__all__ = [
    "PHONE_DIGITS",
    "PHONE_ERROR",
    "digits_only",
    "is_obvious_sequence",
    "is_valid_phone",
    "normalize_phone",
]
