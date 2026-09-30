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
npm test             # Unit tests (node:test) for the rate limiter + SSRF guard
docker compose up --build -d   # Docker launch
```

No lint command is configured.

## Architecture

### Entry Point

`server/app.js` — single file containing all Express middleware, routes, helpers, and API endpoints.

### Routing

| Route | Purpose |
|-------|---------|
| `GET /` `/about` `/contact` `/archive` `/detail` | Public EJS pages |
| `GET /api/opportunities` | List with query filters (country, type, funding, search, tag, status) |
| `GET /api/opportunities/:id` | Single opportunity JSON |
| `POST /api/opportunities` | Create — admin session **or** `Authorization: Bearer $API_TOKEN`, rate-limited |
| `POST /api/assistant` | Visitor chat assistant (Gemini Flash Lite, rate-limited per IP + global daily cap) |
| `POST /newsletter` | Email subscription |
| `GET/POST /admin/*` | Admin CRUD (protected by `requireAdmin` middleware) |
| `GET /admin/users`, `/admin/users/:id` | Member management: list with usage counters, per-member profile/usage; `POST .../logout` (close all sessions) and `POST .../delete` |
| `GET /admin/stats` | Site statistics: connected/active members, daily activity, most viewed and most starred opportunities |
| `GET /robots.txt`, `/sitemap.xml` | SEO endpoints (sitemap needs `PUBLIC_BASE_URL`; lists active opportunities) |

### Data Flow

- Public pages (`views/*.ejs`) render shells; client JS (`public/js/app.js`, `detail.js`) fetches data from `/api/opportunities` and renders listings/details dynamically.
- Admin pages are server-rendered EJS with form submissions.
- Data is read/written via `fs.readFileSync`/`fs.writeFileSync` to JSON files in `server/`.

### Usage analytics (first-party)

`server/analyticsDb.js` owns the `events` table (kinds: `view`, `login`, `register`, `assistant`) and `users.last_seen_at`. Views are recorded on `GET /api/opportunities/:id` (skipped for admin sessions), logins/registrations in `userRoutes.js`, assistant messages in the chat route. Anonymous visitors are keyed by a salted IP hash; raw IPs are never stored. Deleting a member (self or admin) anonymizes their events so "most viewed" stays accurate. "Connected now" = live rows in the `sessions` table carrying a `userId`. `server/adminInsightsRoutes.js` renders `views/admin-users.ejs`, `admin-user.ejs`, `admin-stats.ejs`.

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

## Security

- `server/securityHeaders.js` — CSP (per-request nonce, jQuery CDN allowed), `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, nosniff. Inline `<script>` blocks in views must carry `nonce="<%= cspNonce %>"` or the browser blocks them.
- `server/rateLimit.js` — shared in-memory limiter used by member login/register, `/admin/login`, `/newsletter` and the write API.
- `server/safeFetch.js` — SSRF guard for admin-supplied URLs (AI import): blocks private/loopback/link-local targets, resolves DNS, and re-validates **every** redirect hop.
- Admin credentials are compared in constant time and the session is regenerated on login.

## Environment Variables

See `.env.example`. Required: `ADMIN_USER`, `ADMIN_PASSWORD`. Optional: `PORT` (default 3000), `SESSION_SECRET`, `PUBLIC_BASE_URL` (OG meta, canonical, robots/sitemap), `API_TOKEN` (bearer token for machine writes), `NEWSLETTER_DAILY_EMAIL_LIMIT` (default 200), `GA_MEASUREMENT_ID` (Google Analytics 4; the CSP only allows gtag when set), `DISPLAY_TIMEZONE` (admin date display, default Africa/Tunis).

## Deployment

Render deployment uses the `Dockerfile` (Node 22 Alpine, port 3000). Set env vars in the Render dashboard.
