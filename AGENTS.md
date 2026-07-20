# notes for agents

life-console: npm-workspaces monorepo. `frontend/` Vite + React (custom
router in `router.tsx`, no state library), `backend/` Hono + better-sqlite3
(raw SQL in `queries.ts`, schema in `db.ts`), `shared/` types. Config split:
secrets in `.env`, feature toggles in `settings.json` (schema in
`shared/src/settings.ts`). External sources are adapters in
`backend/src/adapters/`, gated by `settings.json → sources`.

## calendar integration status (2026-07-19)

LIVE and verified against the user's real Google Calendar (36 events synced).
Do NOT stub out `backend/src/adapters/calendar.ts` — it already happened once
and silently broke the sync. If you need a different fetch shape, add a
method; don't replace the file.

- `backend/src/adapters/calendar.ts` — Google Calendar API via OAuth
  (readonly scope), plain fetch, no SDK. `fetchUpcomingEvents(days)` and
  `fetchEventsRange(from, to)` both refresh an access token from
  GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN (.env), call events.list with
  `singleEvents=true` (expands recurrences), and map to the adapter
  `CalendarEvent` (all-day = null times, times localized, deeplink =
  htmlLink). `enabled()` requires both the settings toggle and the env vars.
- `backend/src/google-auth.ts` — one-time refresh-token minting script
  (`npm run auth:google --workspace backend`), loopback redirect on :43117.
- `runCalendarSync` (`backend/src/synthesis.ts`) calls the adapter hourly and
  via `POST /api/sync/calendar`, replacing `source = "calendar"` rows in the
  `events` table for today..+14d via `replaceSourceEvents` (`queries.ts`).
  Manual events are never touched.
- UI (`frontend/src/components/DailyCalendar.tsx`) renders synced events
  read-only (outlined, `.daycal-event.synced` style); double-click opens the
  deeplink instead of deleting.
- Enabled: `settings.json → sources.calendar` is true and the GOOGLE_* creds
  are in `.env` (refresh token minted via `npm run auth:google`).
- Gotcha: npm workspace scripts run with cwd `backend/`, so `.env` at the
  repo root is loaded via `backend/src/env.ts` (path-resolved), not
  `dotenv/config`. One-off tsx scripts must `import "./src/env.ts"` first.
- Fixed 2026-07-19: `REPO_ROOT` in `backend/src/paths.ts` used to resolve one
  level ABOVE the repo; `settings.json` and `data/console.db` were migrated
  back into the repo root when it was corrected.

Do not repurpose the shared `CalendarEvent` in `shared/src/types.ts` for the
adapter — the adapter type is intentionally id/source-free; the sync layer
adds those.

## house style

Keep it simple. No new abstractions, state libraries, or ORMs. Raw SQL in
`queries.ts`, routes inline in `backend/src/index.ts`, per-page useState on
the frontend. No push notifications, no gamification, no real-time.
