# Development

> Skeleton notes. Expand as implementation begins.

## Getting Started

See the root `README.md` for full setup instructions.

Quick start:

```bash
# Frontend
cd frontend
npm install
npm run dev        # http://localhost:5173

# Backend
cd backend
python -m venv venv
# activate the venv, then:
pip install -r requirements.txt
python run.py      # http://localhost:5000
```

## Environment

Copy each `.env.example` to `.env` before running. Never commit `.env`.

## Conventions

- Keep modules small and single-purpose.
- Prefer reusable components over page-specific duplication.
- Follow the existing folder structure; place new code in the matching folder.

## Status

Foundation only — no development workflow beyond scaffolding is established yet.
