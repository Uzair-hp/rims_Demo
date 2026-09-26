# Ruchita Interiors

Internal business management system for **Ruchita Interiors** — a Quotation, Invoice
& Payment Management application delivered as a Progressive Web App (PWA).

The system is intended for a single business user. The architecture leaves room for
future multi-user support, but multi-user functionality is **not** implemented.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Flask |
| Database | SQLite |
| Application | PWA |

## Project Structure

```
ruchita_interiors/
├── frontend/     React + Vite PWA
├── backend/      Flask REST API
├── docs/         Architecture and development notes
├── .gitignore
├── .env.example
└── README.md
```

- **frontend/** — the user interface and client-side application shell.
- **backend/** — the Flask REST API, business rules and persistence.
- **docs/** — lightweight architecture, development and phase notes.

## Requirements

- Node.js
- npm
- Python
- pip
- Python virtual environment

Use current stable versions; no specific version is forced by the foundation.

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Expected frontend URL: `http://localhost:5173`

Build for production:

```bash
npm run build
```

## Backend Setup

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate it:

- Windows: `venv\Scripts\activate`
- Linux/macOS: `source venv/bin/activate`

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the backend:

```bash
python run.py
```

Expected backend URL: `http://localhost:5000`

Health check: `http://localhost:5000/api/health`

## Environment

Each application has its own environment template:

```bash
cd frontend && cp .env.example .env
cd backend  && cp .env.example .env
```

Do **not** commit `.env` files — only the `.env.example` templates.

## Current Status

**Project foundation only. Business functionality has not yet been implemented.**

The folder architecture, configuration templates and requirements files are in
place so that implementation can begin cleanly. The backend is a structural
skeleton at this stage and is not yet runnable.

## Future Modules

- Authentication
- Dashboard
- Clients
- Quotations
- Invoices
- Payments
- Settings
- PDF documents
- PWA enhancements
