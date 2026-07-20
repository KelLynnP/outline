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
  buildLineView,
  buildTodayView,
  carryItem,
  closeItem,
  deleteEvent,
  getOrEmptyStop,
  listAllItems,
  updateStopNotes,
  listEvents,
  listEventsRange,
  logSignal,
  updateItem,
} from "./queries.js";
import { runCalendarSync, scheduleJobs } from "./synthesis.js";
import { adapters } from "./adapters/index.js";
import { heptabase } from "./adapters/heptabase.js";
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
  };
  if (!body?.text?.trim()) return c.json({ error: "text_required" }, 400);
  return c.json(addItem(body));
});

app.patch("/api/items/:id", async (c) => {
  const patch = await c.req.json();
  const item = updateItem(Number(c.req.param("id")), patch);
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

app.post("/api/items/:id/close", async (c) => {
  const item = closeItem(Number(c.req.param("id")));
  if (!item) return c.json({ error: "not_found" }, 404);
  if (heptabase.enabled() && heptabase.appendToTodayJournal) {
    heptabase
      .appendToTodayJournal(`✓ ${item.text} (captured ${item.captured_date})`)
      .catch((e) => console.error("append_to_journal", e));
  }
  return c.json(item);
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
  return c.json(listEvents(date ?? new Date().toISOString().slice(0, 10)));
});

app.post("/api/events", async (c) => {
  const body = (await c.req.json()) as {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    title: string;
  };
  if (!body?.title?.trim() || !body?.date) {
    return c.json({ error: "date_and_title_required" }, 400);
  }
  return c.json(addEvent(body));
});

app.delete("/api/events/:id", (c) => {
  const ok = deleteEvent(Number(c.req.param("id")));
  return c.json({ ok });
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
