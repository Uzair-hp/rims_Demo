# API

> Skeleton notes. Endpoints are implemented in later phases.

## Base

```
http://localhost:5000/api
```

## Implemented Endpoints

None. No business endpoints are implemented in this phase.

A health endpoint is planned purely to verify the backend is running:

```
GET /api/health

{
  "status": "ok",
  "service": "ruchita-interiors-backend"
}
```

## Planned (not implemented)

`/auth`, `/clients`, `/quotations`, `/invoices`, `/payments`, `/settings`.

## Status

Foundation only. No routes, controllers or business APIs exist yet.
