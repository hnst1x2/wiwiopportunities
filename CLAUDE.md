# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WiwiOpportunity — a platform for sharing international opportunities (internships, scholarships, studies, volunteering, jobs). French-first with English i18n support.

## Tech Stack

- **Backend**: Node.js + Express 4.x + EJS templating
- **Storage**: JSON files (`server/opportunities.json`, `server/newsletter.json`) — no database
- **Frontend**: Vanilla JS + jQuery (CDN), CSS (no preprocessor), Font Awesome icons
- **Auth**: express-session with env-based credentials (`ADMIN_USER`, `ADMIN_PASSWORD`)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server with nodemon (auto-restart)
npm start            # Production server (node server/app.js)
docker compose up --build -d   # Docker launch
```

No test or lint commands are configured.

## Architecture

### Entry Point

`server/app.js` — single file containing all Express middleware, routes, helpers, and API endpoints.

### Routing

| Route | Purpose |
|-------|---------|
| `GET /` `/about` `/contact` `/archive` `/detail` | Public EJS pages |
| `GET /api/opportunities` | List with query filters (country, type, funding, search, tag, status) |
| `GET /api/opportunities/:id` | Single opportunity JSON |
| `POST /api/opportunities` | Create (public, no auth) |
| `POST /newsletter` | Email subscription |
| `GET/POST /admin/*` | Admin CRUD (protected by `requireAdmin` middleware) |

### Data Flow

- Public pages (`views/*.ejs`) render shells; client JS (`public/js/app.js`, `detail.js`) fetches data from `/api/opportunities` and renders listings/details dynamically.
- Admin pages are server-rendered EJS with form submissions.
- Data is read/written via `fs.readFileSync`/`fs.writeFileSync` to JSON files in `server/`.

### Key Directories

- `server/config/site.js` — site metadata and social links
- `server/i18n/translations.js` — all FR/EN UI strings (language stored in `wiwi_lang` cookie)
- `views/partials/` — shared EJS partials (header, footer, social-links)
- `public/js/` — client-side scripts: `app.js` (home/archive filtering+pagination), `detail.js` (detail page), `admin.js` (admin table), `base.js` (nav toggle)
- `public/css/` — page-specific stylesheets (base, home, detail, admin, social, info)

### Opportunity Object Shape

```json
{
  "id": 1234567890,
  "title": "", "organization": "", "country": "", "city": "",
  "type": "Stage|Bourse|Volontariat|Job",
  "funding": "Fully funded|Partially funded|Not funded",
  "deadline": "YYYY-MM-DD", "duration": "", "link": "",
  "description": "", "extra": "",
  "tags": ["IT", "Marketing"],
  "featured": true,
  "images": ["https://example.com/photo.jpg", "/uploads/123-abc.jpg"]
}
```

`images` holds up to 10 entries: absolute http(s) URLs or local `/uploads/<file>` paths. Uploads are stored in `DATA_DIR/uploads` (admin-only `POST /admin/upload`, 5 MB max, JPEG/PNG/WebP/GIF/AVIF) and served at `/uploads/*`. The first image is the cover (list card thumbnail); the detail page shows a carousel when there are several.

Active vs archived is determined by comparing `deadline` against today's date (`isActiveOpportunity` helper in `app.js`).

## Environment Variables

See `.env.example`. Required: `ADMIN_USER`, `ADMIN_PASSWORD`. Optional: `PORT` (default 3000), `SESSION_SECRET`, `PUBLIC_BASE_URL` (for OG meta tags).

## Deployment

Render deployment uses the `Dockerfile` (Node 22 Alpine, port 3000). Set env vars in the Render dashboard.
