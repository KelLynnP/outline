# life console

A personal "life console": one workboard page with a timeline spine, a task
board, and a calendar (day / week / month), backed by a small Hono + SQLite
API. Google Calendar syncs in live; tasks, day themes, and manual events are
local. This README is the technical overview for agents working on the code.
Read `AGENTS.md` too — it has the calendar-integration warnings and house
style, and both are load-bearing.

## quick start

```bash
npm install
npm run seed       # populates data/console.db with sample data
npm run dev        # backend on :4000, frontend on :5173 with proxy
```

Open http://localhost:5173. Reset anytime with `rm -f data/console.db && npm run seed`.

## deployment (live since 2026-08)

Production is one Ubuntu DigitalOcean Droplet at `137.184.224.81`, serving
`console.kelsey.xyz` through Cloudflare Tunnel behind Cloudflare Access.
The tunnel handles HTTPS; the app listens privately on `127.0.0.1:4000`.
Note: this is NOT `bbserver` (209.38.72.102) — that droplet hosts an
unrelated project.

What's on the droplet:
- App cloned at `/opt/life-console`, owned by the unprivileged `lifeconsole`
  user (git operations must run as `lifeconsole`, not root).
- systemd units: `life-console.service` (runs
  `node backend/dist/index.js` as `lifeconsole`, `Restart=always`),
  `cloudflared.service` (tunnel), and `life-console-backup.timer`
  (nightly SQLite backups).
- The gitignored `.env`, `settings.json`, and `data/console.db` live only on
  the droplet. The droplet database is the production source of truth; local
  databases are for development and do not synchronize with it.
- System timezone must be `America/Los_Angeles`
  (`timedatectl set-timezone America/Los_Angeles`). The calendar adapter and
  "today" logic use server-local time — when the droplet was on UTC, every
  synced meeting shifted +7h. Re-set this if the droplet is ever rebuilt.

Deploying (manual — there is no deploy script yet). Push `main`, then:

```bash
ssh lifeconsole@137.184.224.81 'cd /opt/life-console \
  && cp data/console.db "data/console.db.bak-$(date +%Y%m%d-%H%M%S)" \
  && git pull --ff-only && npm ci && npm run build'
# only restart if the build above succeeded:
ssh root@137.184.224.81 'systemctl restart life-console \
  && sleep 3 && curl -s http://127.0.0.1:4000/api/health'
```

Health check should print `{"ok":true}`. A failed build leaves the old
service running; restart downtime is a few seconds. Logs:
`journalctl -u life-console` on the droplet.

## architecture

npm-workspaces monorepo, deliberately simple: no ORM, no state library, no
router library.

```
backend/    Hono + better-sqlite3 + node-cron. Raw SQL in queries.ts, routes
            inline in index.ts, schema + ensureColumn migrations in db.ts.
frontend/   Vite + React + TS. One page (HomePage).
            Per-page useState; components get data + callbacks, pages own
            loading. Custom ~40-line router in router.tsx.
shared/     Types (types.ts) and settings schema (settings.ts).
data/       SQLite db (gitignored). settings.json at repo root.
```

Config split: secrets in `.env` (loaded path-resolved via `backend/src/env.ts`
— workspace scripts run with cwd `backend/`, so one-off tsx scripts must
`import "./src/env.ts"` first). Feature toggles in `settings.json`
(`sources.*` gates each adapter in `backend/src/adapters/`).

## data model (sqlite, see backend/src/db.ts)

**items** — tasks and notes.
- `kind`: `"task" | "note"`. Notes are freeform "keep in mind" entries: no
  checkbox in the UI, never listed under done; archiving = closeItem.
- `status`: `open | closed | carried` (+ `closed_date`, full ISO timestamp so
  the UI shows *when* completed; older rows may be date-only).
- `priority` 1–3, `tags` (comma string in db, `string[]` in API), `due_date`.
- `assignee`: free-text person name (stored without `@`); powers the
  "by person" load view. No people directory.
- `parent_id`: task nesting (projects are just tasks with children). Cycles
  are rejected in `updateItem`.

**events** — calendar entries, one row per event.
- `source`: `"manual" | "task" | "calendar"`. `task` events are the scheduled
  block for an item (`item_id` set); a task has at most one — POSTing a new
  task event deletes the old (`deleteTaskEvents`), so re-drop = move.
- `start_time`/`end_time` null ⇒ all-day ("day task" / theme).
- `end_date` ⇒ multi-day all-day span, last day inclusive. List queries match
  every overlapped day (`date <= X AND COALESCE(end_date, date) >= X`).
- `hue` (0–360): user-picked color for manual events.
- calendar-synced rows carry `external_id`, `location`, `description`,
  `attendees` (JSON), `deeplink`.
- List queries LEFT JOIN items to expose `item_tag` (first tag of the linked
  task) for color coding.

**stops / signals / direction** — daily journal summaries + notes, body
signals (meal/bike/ocean/sleep), and the daily direction sentence. Mostly
predate the workboard; day notes live in `stops.notes`.

**period_notes** — freeform week/month/year notes (`key` = `week-YYYY-MM-DD`
configured week start / `month-YYYY-MM` / `year-YYYY`). `PeriodNotes` on the workboard shows
one pane following the day/week/month view, plus optional **pinned** panes
("+" pins any scope anchored at the selected date; pins hold their period
while you navigate, persisted in localStorage `notes.pins`). Day keys
read/write `stops.notes`, other keys this table — all via
`GET/PUT /api/notes/:key`.

`listAllItems` joins task events onto items as `scheduled_date` /
`scheduled_time` — "scheduled" in the UI means "has a calendar block".

## API surface (backend/src/index.ts)

Items: `GET /api/items/all`, `POST /api/items`, `PATCH /api/items/:id`
(text/tag/due_date/priority/tags/assignee/parent_id), `POST .../close`
(also deletes its calendar block), `.../reopen`, `.../carry`,
`DELETE /api/items/:id/schedule` (unschedule = delete task events only).

Events: `GET /api/events?date=` or `?from=&to=`, `POST /api/events`,
`PATCH /api/events/:id` (status, start/end_time, date, hue, end_date —
end_date is nulled if ≤ start date), `DELETE /api/events/:id`. Accept/decline
on Google-synced events also RSVPs via the calendar adapter.

Other: `/api/line`, `/api/today`, `/api/stops/:date`, `/api/notes/:key`,
`/api/signals`,
`/api/settings`, `/api/sources`, `POST /api/sync/calendar`,
`/api/heptabase/todos`.

## frontend map

- `pages/HomePage.tsx` — the home page. Owns `selectedDate` + `view`
  (day/week/month): the **date bar under the timeline is the single source of
  truth** for what all sections display. Owns scheduling callbacks
  (`scheduleTaskAtTime`, `assignTaskToDay` = all-day theme) and `load()`;
  bumps `calVersion` per load so calendars (which fetch their own events)
  refetch — pass it as `refreshKey`.
- `components/Tasks.tsx` — `TaskTable`: composer row (note toggle, prio,
  due, @person, tags, urgent), then sections **today** (flat, everything
  scheduled today) / **to dos** (all open, subgrouped by first tag, nested
  tree) / **by person** / **done** (capped 20). Every section, tag subgroup
  and tree node is a toggle. Rows: check circle (notes get `~`), priority
  bars (click cycles), inline edit (dblclick text; click chips for tags /
  assignee / due-date picker), hover icons (unschedule ↩, unnest ↖, add
  subtask +, archive ×). `TaskComposer`/`TaskMeta` at the top of the file are
  legacy (old pages, removed).
- `components/DailyCalendar.tsx` — biggest file. 24h scrollable track with
  zoom (persisted hourPx), drag-to-schedule with duration-preserving ghost,
  block move/resize (15-min snap), click-empty-slot draft popover, event
  detail popover (Esc / click-away, accept/decline with 6s undo toast,
  editable times, color swatches, guest + description collapse, "until" date
  for all-day spans), quick-done ✓ on task blocks, tasks/declined visibility
  toggles. Note `suppressTrackClick` coordinating popup-close, draft-open and
  resize-release — read it before touching track click handling.
- `components/WeekCalendar.tsx` — hour grid + **all-day lane**: day tasks /
  themes as bars (packed onto shared lines when they don't overlap; dashed =
  multi-day). Drop a task on a *day header* → all-day theme; drop in the grid
  → timed block at that hour. Bars stretch horizontally (drag right edge) to
  set `end_date`. Weekend toggle (5/7 columns).
- `components/DayDots.tsx` — mini month as a small gantt: day circles per
  week with thin colored theme bars beneath; bars draggable between days,
  drops on circles create themes.
- `components/TimelineV2.tsx` — the spine. Highlights the selected day /
  week / month range (`selectedRange` prop, display-only). Day slots are
  click + drop targets.
- `dnd.ts` — all drag/drop plumbing. HTML5 DnD; `TASK_MIME` / `EVENT_MIME`
  carry ids; **duration and source-id ride in extra type names** (readable
  during dragover, when getData is blocked). Rows ignore their own drag
  (`ignoreId`) so dragging out to the calendar isn't captured at dragstart.
- `colors.ts` — tag → stable pastel hue (hash), same formula for manual-event
  hues; used by chips, blocks, bars everywhere.
- `useToggle.ts` — persisted boolean toggle (localStorage). Used liberally;
  the house pattern for any show/hide.
- `time.ts` — 12-hour display formatting (`7a`, `1:30p`). Inputs stay native.

## calendar sync (LIVE — be careful)

`backend/src/adapters/calendar.ts` is verified against the user's real Google
Calendar. **Do not stub it out** (see `AGENTS.md`). Hourly sync + on-demand
`POST /api/sync/calendar` replaces `source = "calendar"` rows for today..+14d
via `replaceSourceEvents`; manual/task events are never touched. Synced
events are read-only in the UI (no move/resize/color); accept/decline RSVPs
back to Google. Known gap: multi-day Google events sync as single-day (the
adapter doesn't map `end.date` spans yet). Setup steps for OAuth live in git
history of this file and in `.env.example`; mint tokens with
`npm run auth:google --workspace backend`.

## conventions

- Keep it grug: raw SQL in `queries.ts`, routes inline, no new abstractions
  or libraries without a strong reason.
- Schema changes via `ensureColumn` in `db.ts` (additive, auto-migrating).
- Components own their fetches only for event data (calendars); items flow
  down from the page. After anything that changes events server-side,
  either reload locally or rely on `refreshKey`.
- Toggles everywhere, persisted via `useToggle`. Prefer adding a toggle over
  removing a feature.
- No push notifications, no gamification, no real-time. Deeplinks out to
  heptabase/Google rather than re-implementing them.

## history / reverting

The old exploration pages (main, opt1 "widgets", opt2 "keep + track") were
removed when the workboard became the app — restore them by reverting the
commit "make workboard the app". Some components they used (`Face`,
`TrainLine`, `TodayPanel`, base `.task-table` CSS) are still in-tree and
unused.
