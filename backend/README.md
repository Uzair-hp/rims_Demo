# Ruchita Interiors — Backend

Flask REST API for the Ruchita Interiors Quotation, Invoice & Payment Management
System.

## Purpose

Serves the JSON API consumed by the `frontend/` PWA, and owns all business rules,
validation and persistence.

## Current Setup Status

**Skeleton / foundation only.** The folder architecture and configuration files
exist, but **no application code has been written yet** — the app factory, models,
routes and services are still empty placeholders. The backend will not start until
the implementation phase wires them together.

## Python Environment Setup

```bash
cd backend

# Create a virtual environment
python -m venv venv
```

Activate it:

- Windows: `venv\Scripts\activate`
- Linux/macOS: `source venv/bin/activate`

## Dependency Installation

```bash
pip install -r requirements.txt
```

## Environment Configuration

```bash
cp .env.example .env
```

Adjust values as needed. Never commit `.env`.

## Development Start Command

```bash
python run.py
```

Expected backend URL: `http://localhost:5000`

Planned health endpoint (not yet implemented): `http://localhost:5000/api/health`

## Folder Structure

```
backend/
├── app/
│   ├── __init__.py          # Flask app factory (placeholder)
│   ├── config/              # Configuration / settings
│   ├── extensions/          # SQLAlchemy and other extensions
│   ├── models/              # Database models
│   ├── routes/              # HTTP route definitions
│   ├── services/            # Business logic
│   ├── schemas/             # Request/response validation
│   ├── utils/               # Shared helpers
│   └── api/                 # API blueprints
├── migrations/              # Database migrations
├── tests/                   # Test suite
├── instance/                # Local instance data (e.g. SQLite DB)
├── uploads/                 # Uploaded files
├── requirements.txt
├── .env.example
├── run.py
└── README.md
```

## Notes

- SQLite is the initial database, configured via `DATABASE_URL`.
- The architecture keeps the ORM in front of the database so a future move to
  PostgreSQL does not require restructuring the project.
