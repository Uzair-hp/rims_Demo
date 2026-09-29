# API

> `PLAN.md` section 9 is the source of truth for API conventions and the full
> endpoint list. This file documents what actually exists today.

## Base URL

```
http://127.0.0.1:5000/api/v1
```

The version prefix is part of the path. The dev server also proxies `/api` to
Flask, but the client uses the absolute URL above (`VITE_API_BASE_URL`), so the
API must list the frontend origin in `CORS_ORIGINS`.

## Conventions

Responses always use one envelope. The frontend client in
`frontend/src/api/client.js` depends on it.

```jsonc
// success
{ "data": { "status": "ok" } }

// failure
{ "error": { "code": "NOT_FOUND", "message": "...", "details": [] } }
```

Error codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`METHOD_NOT_ALLOWED`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`.

`details` carries per-field validation messages as
`[{ "field": "email", "message": "Not a valid email." }]`, which is what lets a
form mark the right input.

## Authentication

Sessions are cookie-based. The browser never sends an `Authorization` header.

| Cookie        | Readable by JS | Lifetime                     | Path              |
| ------------- | -------------- | ---------------------------- | ----------------- |
| `ri_access`   | no (HTTPOnly)  | 15 minutes                   | `/`               |
| `ri_refresh`  | no (HTTPOnly)  | 30 days, sliding             | `/api/v1/auth`    |
| `csrf_token`  | **yes**        | session                      | `/`               |

In production the names are prefixed `__Secure-` and `Secure` is set. All three
are `SameSite=Lax`.

**CSRF double-submit.** Every non-GET request must carry an `X-CSRF-Token` header
matching the `csrf_token` cookie, or the server returns `403 FORBIDDEN`. Because
login is itself a POST, a cold client must fetch `GET /auth/csrf` first.

**Token refresh.** A 15-minute access token is expected to expire mid-session.
The frontend refreshes transparently: on a 401 it calls `POST /auth/refresh` once
per burst of concurrent failures and replays the original request. Only
`/auth/login` and `/auth/refresh` are excluded from that behaviour, since a 401
from either is final.

## Implemented Endpoints

| Method | Path                     | Auth    | Purpose                                  |
| ------ | ------------------------ | ------- | ---------------------------------------- |
| GET    | `/api/v1/health`         | none    | Liveness probe, no database              |
| GET    | `/`                      | none    | Service identity                         |
| GET    | `/api/v1/auth/csrf`      | none    | Issue the CSRF cookie                    |
| POST   | `/api/v1/auth/login`     | CSRF    | Verify credentials, set cookies          |
| POST   | `/api/v1/auth/logout`    | CSRF    | Revoke sessions server-side, clear cookies |
| POST   | `/api/v1/auth/refresh`   | CSRF    | New token pair, sliding window           |
| GET    | `/api/v1/auth/me`        | cookie  | Current user                             |
| PUT    | `/api/v1/auth/password`  | cookie + CSRF | Change password, revoke other sessions |
| GET    | `/api/v1/settings/company` | cookie | The singleton settings row (created with defaults) |
| PUT    | `/api/v1/settings/company` | cookie + CSRF | Save the editable fields; returns the normalized row |
| GET    | `/api/v1/settings/terms` | cookie  | All terms entries                        |
| POST   | `/api/v1/settings/terms` | cookie + CSRF | Create a terms entry (201)          |
| PUT    | `/api/v1/settings/terms/:id` | cookie + CSRF | Update a terms entry              |
| DELETE | `/api/v1/settings/terms/:id` | cookie + CSRF | Delete a terms entry              |
| POST   | `/api/v1/settings/logo`  | cookie + CSRF | Multipart upload, field `logo`         |
| DELETE | `/api/v1/settings/logo`  | cookie + CSRF | Remove the stored logo                  |
| GET    | `/api/v1/uploads/logo`   | cookie  | The stored logo file (long cache)       |

`GET /api/v1/health` is deliberately database-free so it can report "is the API
up" without touching data:

```json
{
  "data": {
    "service": "ruchita-interiors-api",
    "status": "ok",
    "version": "1.0.0",
    "phase": 3
  }
}
```

### Login

```jsonc
// POST /api/v1/auth/login
{ "email": "admin@ruchitainteriors.in", "password": "..." }

// 200
{
  "data": {
    "user": {
      "id": 1,
      "email": "admin@ruchitainteriors.in",
      "name": "Ruchita Interiors",
      "role": "owner",
      "is_active": true,
      "created_at": "2026-09-28T07:20:56.307958"
    }
  }
}
```

A wrong password and an unknown account return the **same** status, code and
message, and the unknown-account path still performs a full scrypt verification
so response time does not reveal which accounts exist.

After five failures for the same IP + email within five minutes, the next attempt
returns `429 RATE_LIMITED`. A successful sign-in clears the count. Failures are
counted rather than attempts (`PLAN.md` B7), and `X-Forwarded-For` is ignored
unless `TRUST_PROXY_HEADERS` is enabled (B8).

### Password change

Requires the current password, enforces the 10-character minimum, bumps
`token_version` and clears the cookies. The response sets
`"reauthenticate": true`: the caller's own session is revoked too, so the client
must sign in again.

### Settings

`GET/PUT /settings/company` read and write the singleton `company_settings` row.
The PUT accepts **any subset** of the editable fields and merges server-side, so
one form per §15 section can save independently without clobbering the others.
Omitted fields are untouched; `null` or `""` clears a nullable field; unknown
keys (including a forged `logo_path`) are ignored. GST is stored in basis points
(`default_gst_bp`, 0–2800) and validity in days; responses are the normalized
saved row.

```jsonc
// PUT /settings/company
{ "quotation_prefix": "RIQ", "default_gst_bp": 1800 }
// 200 → { "data": { "settings": { ...normalized row... } } }
// bad range → 422 with details: [{ "field": "default_gst_bp", "message": "..." }]
```

**Terms** follow the same envelope; `is_default` is exclusive per scope
(§15): promoting one entry demotes the previous default of the same scope.

**Logo upload** (`POST /settings/logo`, multipart field `logo`): PNG, JPEG or
WEBP only, ≤ 2 MB, validated by extension + MIME + magic bytes + a full Pillow
decode; SVG is rejected outright (§16 XSS), as are forged extensions. Files are
stored under a UUID name in `uploads/branding/` — outside the static tree — and
served only through `GET /uploads/logo`, which requires a session and sets a
long-lived cache header (the Settings payload's `updated_at` busts it after a
re-upload).

```text
POST /settings/logo (multipart)   → 200 { "data": { "logo_path": "branding/<uuid>.png" } }
SVG / oversize / forged file      → 422 { "error": { "details": [{ "field": "logo", ... }] } }
GET  /uploads/logo (no logo)      → 404
```

## Status

Phases 1–3: the blueprint, the envelope, error handling, the public health
endpoint, the full auth surface, and the complete settings surface (company
row, terms, logo upload/serving). No business routes exist yet — every
`/clients`, `/quotations`, `/invoices` and `/payments` path returns
`404 NOT_FOUND` until its phase lands.
