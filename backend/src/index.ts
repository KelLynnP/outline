import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./db.js";
import { readSettings, writeSettings } from "./settings.js";
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
  getEvent,
  getOrEmptyStop,
  listAllItems,
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
import { runCalendarSync, scheduleJobs } from "./synthesis.js";
import { adapters } from "./adapters/index.js";
import { heptabase } from "./adapters/heptabase.js";
import { calendar } from "./adapters/calendar.js";
import { backupDir, fetchOpenTodosFromBackup } from "./adapters/heptabase-backup.js";
import { fileURLToPath } from "node:url";

const app = new Hono();
app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/line", (c) => c.json(buildLineView(readSettings())));
app.get("/api/today", (c) => c.json(buildTodayView(readSettings())));

app.get("/api/stops/:date", (c) => c.json(getOrEmptyStop(c.req.param("date"))));

app.put("/api/stops/:date/notes", async (c) => {
  const { notes } = (await c.req.json()) as { notes: string };
  return c.json(updateStopNotes(c.req.param("date"), notes ?? ""));
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

app.post("/api/items/:id/close", async (c) => {
  const id = Number(c.req.param("id"));
  const item = closeItem(id);
  if (!item) return c.json({ error: "not_found" }, 404);
  deleteTaskEvents(id); // a closed task shouldn't linger on the calendar
  if (heptabase.enabled() && heptabase.appendToTodayJournal) {
    heptabase
      .appendToTodayJournal(`✓ ${item.text} (captured ${item.captured_date})`)
      .catch((e) => console.error("append_to_journal", e));
  }
  return c.json(item);
});

app.post("/api/items/:id/reopen", (c) => {
  const item = reopenItem(Number(c.req.param("id")));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
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

app.get("/api/settings", (c) => c.json(readSettings()));
app.put("/api/settings", async (c) => {
  const partial = await c.req.json();
  return c.json(writeSettings(partial));
});

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
