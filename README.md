# life console

a calm, visual "life console" — a train-line timeline as the spine, a today
panel widget, and body-first signals. built to be played with day one on
seeded sample data; real integrations (heptabase, strava, calendar, garmin,
doordash) plug in behind adapters when you're ready.

## quick start

```bash
npm install
npm run seed       # populates data/console.db with ~2 months of sample data
npm run dev        # backend on :4000, frontend on :5173 with proxy
```

open http://localhost:5173

to reset and reseed anytime:

```bash
rm -f data/console.db && npm run seed
```

## layout

```
backend/    Hono + better-sqlite3 + node-cron. serves API and (in prod) the built frontend.
frontend/   Vite + React + TS. the train line, today panel, settings.
shared/     types shared by both.
data/       SQLite db lives here (gitignored).
settings.json   single settings surface (created on first run from defaults).
```

## configuration

everything lives in `settings.json` at the repo root. edit it in the console
settings panel or by hand — both write the same file. see
`shared/src/settings.ts` for the schema and defaults.

## integrations (phase 2+)

each external source is an adapter in `backend/src/adapters/` with a
per-source toggle in `settings.json → sources`. all are off by default and
stubbed. drop your heptabase MCP OAuth token + Anthropic API key in a `.env`
file (see `.env.example`) when you're ready to turn synthesis on.

```
ANTHROPIC_API_KEY=
HEPTABASE_MCP_URL=https://api.heptabase.com/mcp
HEPTABASE_OAUTH_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

### calendar (google, oauth read-only)

the adapter (`backend/src/adapters/calendar.ts`) pulls from the Google
Calendar API with the `calendar.readonly` scope. one-time setup:

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
   → APIs & Services → enable **Google Calendar API**.
2. OAuth consent screen: user type **Internal** (Workspace) — no verification
   needed. add the `calendar.readonly` scope.
3. Credentials → create **OAuth client ID** → type **Desktop app**. put the
   client id + secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. `npm run auth:google --workspace backend` — opens a consent page, prints
   `GOOGLE_REFRESH_TOKEN=...` to paste into `.env`.
5. flip `settings.json → sources.calendar` to `true`, restart the backend.

sync runs hourly (`runCalendarSync` in `backend/src/synthesis.ts`) and on
demand via `POST /api/sync/calendar`. it replaces all `source = "calendar"`
rows in the `events` table for the next 14 days; manual events are never
touched. synced events render outlined in the daily calendar, aren't
deletable from the UI, and double-click opens them in Google Calendar.
`GOOGLE_CALENDAR_ID` in `.env` picks a non-primary calendar if you want one.

## design constitution

no push notifications. no gamification. no real-time. one settings surface.
the console is a vestibule; every piece of content deeplinks to heptabase.
