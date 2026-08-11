import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./db.js";
import { readSettings } from "./settings.js";
import {
  addEvent,
  addItem,
  addRoadmapEntry,
  addRoadmapLane,
  buildLineView,
  buildTodayView,
  carryItem,
  closeItem,
  deleteEvent,
  deleteRoadmapEntry,
  deleteRoadmapLane,
  deleteTaskEvents,
  detachLinearItem,
  getEvent,
  getItem,
  linkItemToLinear,
  getOrEmptyStop,
  getPeriodNotes,
  listAllItems,
  updatePeriodNotes,
  updateEventEndDate,
  updateEventHue,
  updateEventStatus,
  updateEventTimes,
  updateStopNotes,
  listEvents,
  listEventsRange,
  listRoadmapEntries,
  listRoadmapLanes,
  listPublishedRoadmapEntries,
  logSignal,
  reopenItem,
  todayISO,
  updateItem,
  updateRoadmapEntry,
  updateRoadmapLane,
} from "./queries.js";
import { runCalendarSync, runLinearSync, scheduleJobs } from "./synthesis.js";
import { adapters } from "./adapters/index.js";
import { heptabase } from "./adapters/heptabase.js";
import { calendar } from "./adapters/calendar.js";
import {
  createLinearIssue,
  fetchLinearTeams,
  linear,
  setLinearIssueState,
  updateLinearIssue,
} from "./adapters/linear.js";
import { backupDir, fetchOpenTodosFromBackup } from "./adapters/heptabase-backup.js";
import { fileURLToPath } from "node:url";

const app = new Hono();
app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/line", (c) => c.json(buildLineView(readSettings())));
app.get("/api/today", (c) => c.json(buildTodayView(readSettings())));

app.get("/api/stops/:date", (c) => c.json(getOrEmptyStop(c.req.param("date"))));

// Notes for a day / week / month. Day keys are plain dates and keep living
// in stops.notes (pre-existing data); week-/month- keys go to period_notes.
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/notes/:key", (c) => {
  const key = c.req.param("key");
  const notes = DAY_KEY.test(key)
    ? (getOrEmptyStop(key).notes ?? "")
    : getPeriodNotes(key);
  return c.json({ key, notes });
});

app.put("/api/notes/:key", async (c) => {
  const key = c.req.param("key");
  const { notes } = (await c.req.json()) as { notes: string };
  if (DAY_KEY.test(key)) updateStopNotes(key, notes ?? "");
  else updatePeriodNotes(key, notes ?? "");
  return c.json({ key, notes: notes ?? "" });
});

app.get("/api/items", (c) => {
  const settings = readSettings();
  return c.json(buildTodayView(settings).caught);
});

app.get("/api/items/all", (c) => c.json(listAllItems()));

app.post("/api/items", async (c) => {
  const body = (await c.req.json()) as {
    text: string;
    tag?: string;
    due_date?: string | null;
    priority?: 1 | 2 | 3;
    tags?: string[];
    assignee?: string | null;
    parent_id?: number | null;
    kind?: "task" | "note";
    description?: string | null;
  };
  if (!body?.text?.trim()) return c.json({ error: "text_required" }, 400);
  try {
    return c.json(addItem(body));
  } catch (e) {
    if (String(e).includes("parent_not_found")) {
      return c.json({ error: "parent_not_found" }, 400);
    }
    throw e;
  }
});

app.patch("/api/items/:id", async (c) => {
  const patch = await c.req.json();
  const item = updateItem(Number(c.req.param("id")), patch);
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

// For linear rows, push the status change upstream *first* — if we only
// changed it locally, the next sync would revert it.
async function pushLinearState(
  item: { source: string; external_id: string | null },
  type: "completed" | "unstarted",
): Promise<void> {
  if (item.source !== "linear" || !item.external_id || !linear.enabled()) return;
  await setLinearIssueState(item.external_id, type);
}

app.post("/api/items/:id/close", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = getItem(id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  try {
    await pushLinearState(existing, "completed");
  } catch (e) {
    console.error("linear_close", e);
    return c.json({ error: String(e) }, 502);
  }
  const item = closeItem(id)!;
  deleteTaskEvents(id); // a closed task shouldn't linger on the calendar
  if (heptabase.enabled() && heptabase.appendToTodayJournal) {
    heptabase
      .appendToTodayJournal(`✓ ${item.text} (captured ${item.captured_date})`)
      .catch((e) => console.error("append_to_journal", e));
  }
  return c.json(item);
});

app.post("/api/items/:id/reopen", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = getItem(id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  try {
    await pushLinearState(existing, "unstarted");
  } catch (e) {
    console.error("linear_reopen", e);
    return c.json({ error: String(e) }, 502);
  }
  return c.json(reopenItem(id)!);
});

app.get("/api/linear/teams", async (c) => {
  try {
    return c.json(await fetchLinearTeams());
  } catch (e) {
    console.error("linear_teams", e);
    return c.json({ error: String(e) }, 500);
  }
});

// Convert a local task into a Linear issue (the send-to-Linear modal).
app.post("/api/items/:id/linear", async (c) => {
  const id = Number(c.req.param("id"));
  const item = getItem(id);
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.source === "linear") return c.json({ error: "already_linear" }, 400);
  const body = (await c.req.json()) as {
    team_id: string;
    assignee_id?: string | null;
    priority?: number; // Linear scale 0-4
    description?: string | null;
  };
  if (!body?.team_id) return c.json({ error: "team_required" }, 400);
  try {
    const issue = await createLinearIssue({
      teamId: body.team_id,
      title: item.text,
      assigneeId: body.assignee_id,
      priority: body.priority,
      dueDate: item.due_date,
      // The modal prefills with the task's own description; fall back to it.
      description: body.description ?? item.description,
    });
    return c.json(linkItemToLinear(id, issue));
  } catch (e) {
    console.error("linear_create", e);
    return c.json({ error: String(e) }, 502);
  }
});

// Detach: back to a plain local task (the Linear issue is left untouched).
app.delete("/api/items/:id/linear", (c) => {
  const item = detachLinearItem(Number(c.req.param("id")));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

// Edit a linear row's issue in Linear (detail modal): title/description/team/
// assignee/priority/due date. Pushes upstream, then refreshes the local row
// from the returned issue (team moves change the identifier too).
app.patch("/api/items/:id/linear", async (c) => {
  const id = Number(c.req.param("id"));
  const item = getItem(id);
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.source !== "linear" || !item.external_id) {
    return c.json({ error: "not_linear" }, 400);
  }
  const body = (await c.req.json()) as {
    title?: string;
    description?: string | null;
    team_id?: string;
    assignee_id?: string | null;
    priority?: number; // Linear scale 0-4
    due_date?: string | null;
  };
  const input: Parameters<typeof updateLinearIssue>[1] = {};
  if (body.title?.trim()) input.title = body.title.trim();
  if (body.description !== undefined) {
    input.description = body.description?.trim() || null;
  }
  if (body.team_id) input.teamId = body.team_id;
  if (body.assignee_id !== undefined) input.assigneeId = body.assignee_id;
  if (body.priority !== undefined) input.priority = body.priority;
  if (body.due_date !== undefined) input.dueDate = body.due_date || null;
  if (Object.keys(input).length === 0) return c.json(item);
  try {
    const issue = await updateLinearIssue(item.external_id, input);
    return c.json(linkItemToLinear(id, issue));
  } catch (e) {
    console.error("linear_update", e);
    return c.json({ error: String(e) }, 502);
  }
});

// Move a linear row's issue to backlog / todo / in progress. Push upstream,
// then re-sync so the local state name matches whatever Linear picked.
app.post("/api/items/:id/linear-state", async (c) => {
  const id = Number(c.req.param("id"));
  const item = getItem(id);
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.source !== "linear" || !item.external_id) {
    return c.json({ error: "not_linear" }, 400);
  }
  const { type } = (await c.req.json()) as {
    type: "backlog" | "unstarted" | "started";
  };
  if (!["backlog", "unstarted", "started"].includes(type)) {
    return c.json({ error: "bad_type" }, 400);
  }
  try {
    await setLinearIssueState(item.external_id, type);
    await runLinearSync();
    return c.json(getItem(id));
  } catch (e) {
    console.error("linear_state", e);
    return c.json({ error: String(e) }, 502);
  }
});

// Create a brand-new Linear issue (e.g. for a teammate) and keep a local
// linear row for it, so it shows on the board and updates as it completes.
app.post("/api/linear/issues", async (c) => {
  const body = (await c.req.json()) as {
    team_id: string;
    title: string;
    description?: string | null;
    assignee_id?: string | null;
    priority?: number; // Linear scale 0-4
    due_date?: string | null;
  };
  if (!body?.team_id) return c.json({ error: "team_required" }, 400);
  if (!body?.title?.trim()) return c.json({ error: "title_required" }, 400);
  try {
    const issue = await createLinearIssue({
      teamId: body.team_id,
      title: body.title.trim(),
      assigneeId: body.assignee_id,
      priority: body.priority,
      dueDate: body.due_date,
      description: body.description,
    });
    const item = addItem({ text: issue.title });
    return c.json(linkItemToLinear(item.id, issue));
  } catch (e) {
    console.error("linear_new_issue", e);
    return c.json({ error: String(e) }, 502);
  }
});

// Remove a task's calendar block without touching the item itself.
app.delete("/api/items/:id/schedule", (c) => {
  return c.json({ removed: deleteTaskEvents(Number(c.req.param("id"))) });
});

app.post("/api/items/:id/carry", (c) => {
  const item = carryItem(Number(c.req.param("id")));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

app.post("/api/signals", async (c) => {
  const body = (await c.req.json()) as {
    type: "meal" | "bike" | "ocean" | "sleep";
    timestamp?: string;
    note?: string | null;
  };
  if (!body?.type) return c.json({ error: "type_required" }, 400);
  return c.json(logSignal(body));
});

app.get("/api/events", (c) => {
  const date = c.req.query("date");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && to) return c.json(listEventsRange(from, to));
  return c.json(listEvents(date ?? todayISO()));
});

app.post("/api/events", async (c) => {
  const body = (await c.req.json()) as {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    end_date?: string | null;
    title: string;
    source?: string;
    item_id?: number | null;
    status?: "pending" | "confirmed" | null;
    deeplink?: string | null;
    external_id?: string | null;
  };
  if (!body?.title?.trim() || !body?.date) {
    return c.json({ error: "date_and_title_required" }, 400);
  }
  // A task has at most one scheduled block: re-dropping moves it.
  if (body.source === "task" && body.item_id) {
    deleteTaskEvents(body.item_id);
  }
  return c.json(addEvent(body));
});

app.patch("/api/events/:id", async (c) => {
  const body = (await c.req.json()) as {
    status?: "pending" | "confirmed" | null;
    start_time?: string | null;
    end_time?: string | null;
    date?: string;
    hue?: number | null;
    end_date?: string | null;
  };
  const id = Number(c.req.param("id"));
  const before = getEvent(id);
  if (!before) return c.json({ error: "not_found" }, 404);
  let updated = before;
  if ("start_time" in body || "end_time" in body || "date" in body) {
    updated = updateEventTimes(
      id,
      body.start_time !== undefined ? body.start_time : before.start_time,
      body.end_time !== undefined ? body.end_time : before.end_time,
      body.date,
    )!;
  }
  if ("hue" in body) {
    updated = updateEventHue(id, body.hue ?? null)!;
  }
  if ("end_date" in body) {
    // Guard: span end can't precede its start day.
    const start = body.date ?? before.date;
    const end = body.end_date && body.end_date > start ? body.end_date : null;
    updated = updateEventEndDate(id, end)!;
  }
  if (!("status" in body)) return c.json(updated);
  const status = body.status ?? null;
  updated = updateEventStatus(id, status)!;
  if (
    status === "confirmed" &&
    before?.source &&
    before.source !== "task" &&
    before.source !== "manual" &&
    before.external_id &&
    calendar.enabled() &&
    calendar.confirmEvent
  ) {
    calendar
      .confirmEvent(before.external_id)
      .catch((e) => console.error("calendar.confirmEvent", e));
  }
  return c.json(updated);
});

app.delete("/api/events/:id", (c) => {
  const id = Number(c.req.param("id"));
  const before = getEvent(id);
  const ok = deleteEvent(id);
  if (
    ok &&
    before?.source &&
    before.source !== "task" &&
    before.source !== "manual" &&
    before.external_id &&
    calendar.enabled() &&
    calendar.rejectEvent
  ) {
    calendar
      .rejectEvent(before.external_id)
      .catch((e) => console.error("calendar.rejectEvent", e));
  }
  return c.json({ ok });
});

app.get("/api/roadmap/lanes", (c) => c.json(listRoadmapLanes()));

app.post("/api/roadmap/lanes", async (c) => {
  const body = (await c.req.json()) as { name: string };
  if (!body?.name?.trim()) return c.json({ error: "name_required" }, 400);
  return c.json(addRoadmapLane(body));
});

app.patch("/api/roadmap/lanes/:id", async (c) => {
  const lane = updateRoadmapLane(Number(c.req.param("id")), await c.req.json());
  return lane ? c.json(lane) : c.json({ error: "not_found" }, 404);
});

app.delete("/api/roadmap/lanes/:id", (c) =>
  c.json({ ok: deleteRoadmapLane(Number(c.req.param("id"))) }),
);

app.get("/api/roadmap/entries", (c) => {
  const today = todayISO();
  return c.json(
    listRoadmapEntries(c.req.query("from") ?? today, c.req.query("to") ?? today),
  );
});

app.post("/api/roadmap/entries", async (c) => {
  const body = (await c.req.json()) as {
    lane_id: number;
    title: string;
    kind: "span" | "milestone";
    start_date: string;
    end_date?: string | null;
    notes?: string | null;
    theme?: string | null;
    color?: string;
    row_position?: number | null;
    transparent?: boolean;
    opacity?: number;
    published?: boolean;
  };
  if (
    !body?.title?.trim() ||
    !body.start_date ||
    !body.lane_id ||
    !["span", "milestone"].includes(body.kind)
  ) {
    return c.json({ error: "lane_title_kind_and_start_required" }, 400);
  }
  return c.json(addRoadmapEntry(body));
});

app.patch("/api/roadmap/entries/:id", async (c) => {
  const entry = updateRoadmapEntry(Number(c.req.param("id")), await c.req.json());
  return entry ? c.json(entry) : c.json({ error: "not_found" }, 404);
});

app.delete("/api/roadmap/entries/:id", (c) =>
  c.json({ ok: deleteRoadmapEntry(Number(c.req.param("id"))) }),
);

app.post("/api/roadmap/publish", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { dry_run?: boolean };
    return c.json(
      await calendar.publishRoadmap?.(
        listPublishedRoadmapEntries(),
        body.dry_run === true,
      ),
    );
  } catch (e) {
    console.error("roadmap_publish", e);
    return c.json({ error: String(e) }, 500);
  }
});

// On-demand pull of open todos from Heptabase (no storage yet — experiment).
// Prefers the local backup parser (private, free); falls back to Claude+MCP.
app.get("/api/heptabase/todos", async (c) => {
  const tag = c.req.query("tag") ?? "#todo";
  if (backupDir()) return c.json(fetchOpenTodosFromBackup(tag));
  if (!heptabase.enabled() || !heptabase.fetchOpenTodos) {
    return c.json({ error: "heptabase_disabled" }, 503);
  }
  try {
    return c.json(await heptabase.fetchOpenTodos(tag));
  } catch (e) {
    console.error("heptabase_todos", e);
    return c.json({ error: String(e) }, 500);
  }
});

app.post("/api/sync/calendar", async (c) => {
  try {
    const synced = await runCalendarSync();
    return c.json({ ok: true, synced });
  } catch (e) {
    console.error("calendar_sync", e);
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.post("/api/sync/linear", async (c) => {
  try {
    const result = await runLinearSync();
    if (!result) return c.json({ ok: false, error: "linear_disabled" }, 400);
    return c.json({ ok: true, ...result });
  } catch (e) {
    console.error("linear_sync", e);
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// Settings are read-only over HTTP; edit settings.json directly.
app.get("/api/settings", (c) => c.json(readSettings()));

app.get("/api/sources", (c) =>
  c.json(
    Object.values(adapters).map((a) => ({ name: a.name, enabled: a.enabled() })),
  ),
);

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, "..", "..", "frontend", "dist");
if (fs.existsSync(staticDir)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), staticDir) || "." }));
}

scheduleJobs();

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`life-console backend on http://localhost:${info.port}`);
});
