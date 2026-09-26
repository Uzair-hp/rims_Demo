# Architecture

> Skeleton notes. The full architecture document will be written alongside the
> implementation phases.

## Overview

Ruchita Interiors is split into two independent applications that communicate over
a REST API:

```
Browser (PWA)  →  frontend/ (React + Vite)  →  REST API  →  backend/ (Flask)  →  SQLite
```

## Principles

- Separation of concerns: UI, transport, business rules and persistence stay apart.
- Reusable components; small, focused modules; no giant files.
- Environment-based configuration; no hardcoded secrets.
- Clear API/frontend separation.
- Future-proofing for PostgreSQL, multi-user support and document generation —
  without implementing them yet.

## Layers

- **Frontend** — routing, layouts, pages, reusable components, API client.
- **Backend** — app factory, blueprints per domain, service layer, models, schemas.
- **Database** — accessed only through the ORM so the storage engine can change.

## Status

Foundation only. No layers are implemented yet.
