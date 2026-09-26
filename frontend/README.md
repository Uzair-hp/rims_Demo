# Ruchita Interiors — Frontend

React + Vite single-page application (PWA-ready) for the Ruchita Interiors
Quotation, Invoice & Payment Management System.

## Purpose

Provides the user interface for the internal business management system, and talks
to the Flask REST API in `../backend`.

## Current Setup Status

**Skeleton / foundation only.** The folder architecture exists, the app shell
renders, and the dev server/build work — but **no business functionality is
implemented**. Routing, pages, components and styles are empty placeholders.

## Installation

```bash
cd frontend
npm install
```

## Development Command

```bash
npm run dev
```

Expected frontend URL: `http://localhost:5173`

## Build Command

```bash
npm run build
```

Preview a production build:

```bash
npm run preview
```

## Environment Configuration

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Base URL of the backend API | `http://localhost:5000/api` |

Never commit `.env`.

## Folder Structure

```
frontend/
├── public/
│   ├── icons/               # PWA / favicon icons
│   └── assets/              # Public static assets
├── src/
│   ├── assets/              # images / icons / branding
│   ├── components/          # common, layout, navigation, forms, tables, modals, feedback
│   ├── pages/               # Login, Dashboard, Clients, Quotations, Invoices, Settings
│   ├── layouts/             # Page layout shells
│   ├── routes/              # Route definitions
│   ├── services/            # api / auth clients
│   ├── hooks/               # Reusable hooks
│   ├── context/             # React context providers
│   ├── utils/               # Shared helpers
│   ├── constants/           # Shared constants
│   ├── styles/              # tokens / globals / components
│   ├── config/              # Frontend configuration
│   ├── App.jsx              # Application shell
│   └── main.jsx             # Entry point
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Tech Stack

- React + Vite (JavaScript)
- React Router (to be added in the routing phase)
- Plain CSS with a design-token structure (brand tokens to be defined later)
- PWA-ready structure (manifest/service worker to be added later)
