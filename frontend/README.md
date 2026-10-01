# Ruchita Interiors - Frontend

React + Vite single-page application (PWA) for the Ruchita Interiors Quotation,
Invoice & Payment Management System. It talks to the Flask REST API in
`../backend`.

## Current Setup Status

**Phases 1 and 2 are complete.** The app shell, design tokens, routing, PWA
plumbing and authentication are implemented and tested. Business screens are
intentionally placeholders that state which phase delivers them:

- Responsive shell: fixed sidebar at `lg` and up, top bar plus a five-slot bottom
  bar below it, with More and New sheets.
- Light and dark themes, system-following by default, persisted locally, applied
  before first paint so there is no white flash.
- All twelve routes from the plan, plus a 404 page.
- Installable PWA with a generated service worker and maskable icons.
- **Authentication**: `AuthProvider` resolves the session from `GET /auth/me` on
  load, `RequireAuth` guards every route except `/login`, and sign-out is
  available from the sidebar and the mobile More sheet. A real Login page replaces
  the Phase 1 placeholder.

## Installation

```bash
cd frontend
npm install
```

## Development Command

```bash
npm run dev
```

Expected URL: `http://localhost:5173`. The dev server proxies `/api` to
`http://127.0.0.1:5000`, but the client uses the absolute `VITE_API_BASE_URL`, so
the API must list this origin in `CORS_ORIGINS`. Auth cookies are `SameSite=Lax`,
which means production must serve both from the same site.

## Commands

| Command                 | Purpose                       |
| ----------------------- | ----------------------------- |
| `npm run dev`           | Dev server with HMR           |
| `npm run build`         | Production build into `dist/` |
| `npm run preview`       | Serve the production build    |
| `npm run lint`          | ESLint                        |
| `npm run format`        | Prettier write                |
| `npm run format:check`  | Prettier check (CI gate)      |
| `npm test`              | Vitest, single run            |
| `npm run test:watch`    | Vitest in watch mode          |
| `npm run test:coverage` | Vitest with V8 coverage       |

## Environment Configuration

```bash
cp .env.example .env
```

| Variable            | Description                           | Default                        |
| ------------------- | ------------------------------------- | ------------------------------ |
| `VITE_API_BASE_URL` | API base URL, version prefix built in | `http://localhost:5000/api/v1` |

Never commit `.env`.

## Styling

There is no CSS framework and no utility library. Every raw value lives in
`src/styles/tokens.css`; component and page stylesheets consume it through
`var(--token)`. That is what makes the dark theme a variable swap rather than a
second stylesheet.

```
src/styles/
├── tokens.css   # the only file with raw values
├── base.css     # reset, element defaults, a11y primitives
├── print.css    # A4 page box and print-only rules
└── index.css    # import order
```

Co-located `*.module.css` files hold component and page styles.

## Authentication Notes

- `AuthProvider` is mounted above the router in `main.jsx`, because `RequireAuth`
  needs to redirect the whole tree.
- `RequireAuth` and `RedirectIfAuthenticated` are a UX convenience only. The
  backend enforces auth on every endpoint, so bypassing the guard in the browser
  gains nothing.
- `client.js` adds `X-CSRF-Token` to non-GET requests and refreshes an expired
  access token once per burst of 401s, then replays the original request. Only
  `/auth/login` and `/auth/refresh` are exempt.
- The shell shows a neutral "Checking your session…" screen while `/auth/me` is
  in flight, so a reload never flashes the login page.

## Folder Structure

```
frontend/
├── public/
│   ├── brand/logo.svg       # shipped optimized vector logo
│   └── icons/               # PWA / favicon icons, generated
├── src/
│   ├── api/                 # the only place fetch is called
│   │   ├── client.js        # base URL, credentials, CSRF, 401 refresh, errors
│   │   ├── endpoints/       # one module per resource, incl. auth.js
│   │   └── health.js
│   ├── app/                 # router, routes, theme, providers, error boundary
│   ├── components/
│   │   ├── layout/          # AppShell, Sidebar (rail + drawer), TopBar, NavDrawer
│   │   └── ui/              # Button, Card, EmptyState, Sheet, Icon, …
│   ├── features/auth/       # AuthProvider, guards, LoginPage
│   ├── hooks/               # useMediaQuery, usePwaInstall
│   ├── lib/                 # breakpoint helpers
│   ├── pages/               # one file per route
│   ├── styles/              # tokens, base, print
│   └── test/setup.js
├── index.html
├── vite.config.js
└── eslint.config.js
```

## Regenerating Brand Images

Brand assets are generated from the official source vector `brand/logo.svg`,
never hand-edited, in two steps:

```bash
node scripts/optimize_logo.mjs          # brand/logo.svg -> frontend/public/brand/logo.svg
python scripts/generate_brand_icons.py  # favicon, PWA and iOS PNGs from the shipped vector
```

The optimizer reduces the ~2 MB traced source to the ~124 KB shipped vector and
refuses to write anything over 150 KB. See
[../docs/development.md](../docs/development.md#L175-L201) for the canonical
description of the pipeline, flags and dependencies.

## Tech Stack

- React 19 with Vite, JavaScript only (no TypeScript)
- React Router 7
- Plain CSS with custom properties, CSS Modules for components
- Self-hosted fonts via @fontsource (DM Sans, Cormorant Garamond, Cinzel) — no CDN
- Vitest, Testing Library, jsdom
- ESLint, Prettier
- vite-plugin-pwa
