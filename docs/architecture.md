# Architecture

> `PLAN.md` is the source of truth for the full design. This file records the
> shape that actually exists today.

## Overview

Ruchita Interiors is split into two independently runnable applications that talk
over a versioned REST API:

```
Browser (PWA)  →  frontend/ (React + Vite)  →  /api/v1  →  backend/ (Flask)  →  SQLite
```

In development, Vite proxies `/api` to `http://127.0.0.1:5000`, but the client
uses the absolute `VITE_API_BASE_URL`, so requests are cross-origin and the API's
`CORS_ORIGINS` must include the web origin. Auth cookies are `SameSite=Lax`
throughout, which is what CSRF double-submit relies on; it also means production
must serve both applications from the same site.

## Principles

- Separation of concerns: UI, transport, business rules and persistence stay apart.
- Reusable components, small focused modules, no giant files.
- Environment-based configuration; no hardcoded secrets.
- Backend-authoritative totals. The client never computes a final figure.
- Room for PostgreSQL, multi-user support and document generation — without
  implementing them yet.

## Frontend layers

| Layer         | Location                | Rule                                      |
| ------------- | ----------------------- | ----------------------------------------- |
| App / routing | `src/app/`              | Only place that maps URLs to pages        |
| Pages         | `src/pages/`            | Compose components, own no transport code |
| Features      | `src/features/`         | Cross-cutting behaviour, e.g. `auth/`     |
| Components    | `src/components/`       | `ui/` is generic, `layout/` is app chrome |
| Hooks         | `src/hooks/`            | Reusable stateful behaviour               |
| Transport     | `src/api/`              | The only place `fetch` is called          |
| Design tokens | `src/styles/tokens.css` | The only file allowed raw values          |

`client.js` unwraps the response envelope and turns non-2xx responses into a
single `ApiError` shape, so pages never inspect `response.ok` themselves. It also
owns the two cross-cutting transport concerns: attaching `X-CSRF-Token` to
mutations, and refreshing an expired access token once per burst of 401s before
replaying the request.

## Backend layers

| Layer       | Location          | Rule                                                        |
| ----------- | ----------------- | ----------------------------------------------------------- |
| App factory | `app/__init__.py` | Builds config, extensions, blueprints, error handlers       |
| Blueprints  | `app/api/`        | One blueprint per domain, mounted under `/api/v1`           |
| Services    | `app/services/`   | Business rules and calculations; the single source of truth |
| Models      | `app/models/`     | ORM only; reached through services                          |
| Schemas     | `app/schemas/`    | Request validation with Marshmallow                         |
| Seed        | `app/seed/`       | `flask seed-admin` and `flask seed-defaults`, the only way  |
|             |                   | accounts and starter settings are created                   |

`create_app(test_config)` accepts per-app overrides, and everything downstream -
CORS, database URI, cookie names, error handlers - reads from `app.config` rather
than the environment singleton, so tests and per-environment deployments work.

## Authentication

There is no global auth middleware. Each endpoint is either deliberately public
(`/health`, `POST /auth/login`, `GET /auth/csrf`) or carries
`@login_required`. The decorator resolves the user from the access cookie and
returns a 401 envelope otherwise; a missing user is not an exception at that
layer, so `load_current_user()` returning `None` is a normal, cheap answer.

CSRF is likewise per-endpoint (`@csrf_protect` on every non-GET) rather than
global, so the public bootstrap endpoints cannot accidentally require a token
they are there to issue.

Because the tokens are stateless, revocation goes through `users.token_version`:
logout and password change increment it, and any refresh token carrying an older
claim is rejected. Logout resolves the user from the refresh cookie when the
access token is missing or expired, otherwise a signed-out user's captured
refresh token would stay valid.

## Error handling

The backend returns one envelope for every outcome, success or failure:

```jsonc
{ "data": { } }
{ "error": { "code": "NOT_FOUND", "message": "...", "details": [] } }
```

HTTP status codes stay meaningful (404 for unknown paths, 409 for conflicts) and
`code` carries the machine-readable reason. The frontend `ErrorBoundary` is the
last resort only; `ApiStatus` in the top bar surfaces connectivity problems
without blocking the page.

## Status

Phases 1, 2 and 3 complete. The frontend has its app shell, routing, tokens,
theming, PWA plumbing, the auth feature and the Settings UI; the backend has its
factory, configuration, database extension, error handlers, the auth endpoints,
the full section 8.3 business schema (one migration), the settings and logo
endpoints, and the seed CLIs. Client records, quotations and invoices arrive in
Phases 4-7.
