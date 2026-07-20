import type {
  BodySignal,
  CalendarEvent,
  CaughtItem,
  DirectionSentence,
  LineView,
  Priority,
  Settings,
  Stop,
  TodayView,
} from "@life-console/shared";
import { db } from "./db.js";
import { readSettings } from "./settings.js";

type ItemRow = {
  id: number;
  text: string;
  tag: string;
  captured_date: string;
  due_date: string | null;
  status: "open" | "closed" | "carried";
  source_deeplink: string | null;
  closed_date: string | null;
  priority: number;
  tags: string;
};

type SignalRow = {
  id: number;
  type: string;
  timestamp: string;
  source: string;
  note: string | null;
};

type StopRow = {
  date: string;
  summary: string | null;
  journal_deeplink: string | null;
  enrichment: string | null;
  notes: string | null;
};

const rowToItem = (r: ItemRow): CaughtItem => ({
  id: r.id,
  text: r.text,
  tag: r.tag,
  captured_date: r.captured_date,
  due_date: r.due_date,
  status: r.status,
  source_deeplink: r.source_deeplink,
  closed_date: r.closed_date,
  priority: ((r.priority as Priority) ?? 2) as Priority,
  tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
});
const rowToSignal = (r: SignalRow): BodySignal => ({
  id: r.id,
  type: r.type as BodySignal["type"],
  timestamp: r.timestamp,
  source: r.source as BodySignal["source"],
  note: r.note,
});
const rowToStop = (r: StopRow): Stop => ({
  date: r.date,
  summary: r.summary,
  journal_deeplink: r.journal_deeplink,
  enrichment: r.enrichment ? JSON.parse(r.enrichment) : null,
  notes: r.notes ?? null,
});

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function todayISO() {
  return ymd(new Date());
}

function shift(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return ymd(d);
}

export function getLatestDirection(): DirectionSentence | null {
  const row = db
    .prepare(
      "SELECT sentence, generated_at FROM direction ORDER BY generated_at DESC LIMIT 1",
    )
    .get() as { sentence: string; generated_at: string } | undefined;
  return row ?? null;
}

export function setDirection(sentence: string) {
  db.prepare(
    "INSERT INTO direction (sentence, generated_at) VALUES (?, ?)",
  ).run(sentence, iso(new Date()));
}

export function listOpenItems(): CaughtItem[] {
  return (
    db
      .prepare(
        `SELECT * FROM items WHERE status IN ('open','carried')
         ORDER BY (tag = ?) DESC, priority ASC,
                  CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                  due_date ASC, captured_date DESC`,
      )
      .all(readSettings().tags.urgent) as ItemRow[]
  ).map(rowToItem);
}

export function listAllItems(): CaughtItem[] {
  return (
    db
      .prepare("SELECT * FROM items ORDER BY captured_date DESC")
      .all() as ItemRow[]
  ).map(rowToItem);
}

export function listCarriedItems(): CaughtItem[] {
  return (
    db
      .prepare("SELECT * FROM items WHERE status = 'carried' ORDER BY captured_date")
      .all() as ItemRow[]
  ).map(rowToItem);
}

export function listFutureDatedItems(): CaughtItem[] {
  const today = todayISO();
  return (
    db
      .prepare(
        "SELECT * FROM items WHERE due_date IS NOT NULL AND due_date >= ? AND status != 'closed' ORDER BY due_date",
      )
      .all(today) as ItemRow[]
  ).map(rowToItem);
}

export function addItem(input: {
  text: string;
  tag?: string;
  due_date?: string | null;
  source_deeplink?: string | null;
  priority?: Priority;
  tags?: string[];
}): CaughtItem {
  const settings = readSettings();
  const tag = input.tag ?? settings.tags.normal;
  const priority = input.priority ?? 2;
  const tagList = (input.tags ?? []).join(",");
  const info = db
    .prepare(
      `INSERT INTO items (text, tag, captured_date, due_date, status, source_deeplink, priority, tags)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(
      input.text,
      tag,
      todayISO(),
      input.due_date ?? null,
      input.source_deeplink ?? null,
      priority,
      tagList,
    );
  return rowToItem(
    db.prepare("SELECT * FROM items WHERE id = ?").get(info.lastInsertRowid) as ItemRow,
  );
}

export function updateItem(
  id: number,
  patch: {
    text?: string;
    tag?: string;
    due_date?: string | null;
    priority?: Priority;
    tags?: string[];
  },
): CaughtItem | null {
  const current = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
    | ItemRow
    | undefined;
  if (!current) return null;
  const next = {
    text: patch.text ?? current.text,
    tag: patch.tag ?? current.tag,
    due_date: patch.due_date === undefined ? current.due_date : patch.due_date,
    priority: patch.priority ?? current.priority,
    tags: patch.tags ? patch.tags.join(",") : current.tags,
  };
  db.prepare(
    "UPDATE items SET text=?, tag=?, due_date=?, priority=?, tags=? WHERE id=?",
  ).run(next.text, next.tag, next.due_date, next.priority, next.tags, id);
  return rowToItem(
    db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow,
  );
}

export function closeItem(id: number): CaughtItem | null {
  db.prepare(
    "UPDATE items SET status='closed', closed_date=? WHERE id = ?",
  ).run(todayISO(), id);
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
    | ItemRow
    | undefined;
  return row ? rowToItem(row) : null;
}

export function carryItem(id: number): CaughtItem | null {
  db.prepare("UPDATE items SET status='carried' WHERE id = ?").run(id);
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
    | ItemRow
    | undefined;
  return row ? rowToItem(row) : null;
}

export function logSignal(input: {
  type: BodySignal["type"];
  timestamp?: string;
  source?: BodySignal["source"];
  note?: string | null;
}): BodySignal {
  const info = db
    .prepare(
      "INSERT INTO signals (type, timestamp, source, note) VALUES (?, ?, ?, ?)",
    )
    .run(
      input.type,
      input.timestamp ?? iso(new Date()),
      input.source ?? "tap",
      input.note ?? null,
    );
  return rowToSignal(
    db.prepare("SELECT * FROM signals WHERE id = ?").get(info.lastInsertRowid) as SignalRow,
  );
}

export function recentSignals(hours = 72): BodySignal[] {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return (
    db
      .prepare(
        "SELECT * FROM signals WHERE timestamp >= ? ORDER BY timestamp DESC",
      )
      .all(since) as SignalRow[]
  ).map(rowToSignal);
}

function lastSignalOfType(type: BodySignal["type"]): BodySignal | null {
  const row = db
    .prepare(
      "SELECT * FROM signals WHERE type = ? ORDER BY timestamp DESC LIMIT 1",
    )
    .get(type) as SignalRow | undefined;
  return row ? rowToSignal(row) : null;
}

export function listStops(from: string, to: string): Stop[] {
  return (
    db
      .prepare(
        "SELECT * FROM stops WHERE date BETWEEN ? AND ? ORDER BY date",
      )
      .all(from, to) as StopRow[]
  ).map(rowToStop);
}

export function getStop(date: string): Stop | null {
  const row = db.prepare("SELECT * FROM stops WHERE date = ?").get(date) as
    | StopRow
    | undefined;
  return row ? rowToStop(row) : null;
}

export function upsertStop(stop: Stop) {
  db.prepare(
    `INSERT INTO stops (date, summary, journal_deeplink, enrichment, notes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       summary = excluded.summary,
       journal_deeplink = excluded.journal_deeplink,
       enrichment = excluded.enrichment,
       notes = COALESCE(excluded.notes, stops.notes)`,
  ).run(
    stop.date,
    stop.summary,
    stop.journal_deeplink,
    stop.enrichment ? JSON.stringify(stop.enrichment) : null,
    stop.notes,
  );
}

export function updateStopNotes(date: string, notes: string): Stop {
  db.prepare(
    `INSERT INTO stops (date, notes) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET notes = excluded.notes`,
  ).run(date, notes);
  return getStop(date)!;
}

export function getOrEmptyStop(date: string): Stop {
  return (
    getStop(date) ?? {
      date,
      summary: null,
      journal_deeplink: `heptabase://journal/${date}`,
      enrichment: null,
      notes: null,
    }
  );
}

const FIXED_MONTH_HUES = [
  "#ffd9b0", // sunny orange
  "#cfe8d5", // fresh mint
  "#d5daf0", // periwinkle
  "#ffe0e0", // blush
  "#fff2b3", // butter yellow
  "#c8e0ea", // sky blue
];

export function buildLineView(settings: Settings): LineView {
  const today = todayISO();
  const recent = Math.max(1, settings.line.recent_stops);
  const monthsVisible = Math.max(1, settings.line.months_visible);

  const startDate = shift(today, -(monthsVisible * 31));
  const stops = listStops(startDate, today);

  const recentDates = new Set<string>();
  for (let i = 0; i < recent; i++) recentDates.add(shift(today, -i));

  const detailedStops: Stop[] = [];
  const dots: string[] = [];
  for (const s of stops) {
    if (recentDates.has(s.date) && s.date !== today) detailedStops.push(s);
    else if (s.date !== today) dots.push(s.date);
  }

  const months: LineView["months"] = [];
  const now = new Date(today + "T00:00:00");
  for (let i = monthsVisible - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "long" });
    const hue = FIXED_MONTH_HUES[(d.getMonth() + d.getFullYear()) % FIXED_MONTH_HUES.length];
    months.push({ key, label, hue });
  }

  const future = listFutureDatedItems().map((it) => ({
    date: it.due_date!,
    text: it.text,
    tag: it.tag,
  }));

  return {
    today,
    months,
    stops: detailedStops,
    dots,
    future_stops: future,
  };
}

type EventRow = {
  id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  source: string;
  deeplink: string | null;
};

const rowToEvent = (r: EventRow): CalendarEvent => ({ ...r });

export function listEvents(date: string): CalendarEvent[] {
  return (
    db
      .prepare(
        "SELECT * FROM events WHERE date = ? ORDER BY COALESCE(start_time, '99:99')",
      )
      .all(date) as EventRow[]
  ).map(rowToEvent);
}

export function listEventsRange(from: string, to: string): CalendarEvent[] {
  return (
    db
      .prepare(
        "SELECT * FROM events WHERE date BETWEEN ? AND ? ORDER BY date, COALESCE(start_time, '99:99')",
      )
      .all(from, to) as EventRow[]
  ).map(rowToEvent);
}

export function addEvent(input: {
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  title: string;
  source?: string;
  deeplink?: string | null;
}): CalendarEvent {
  const info = db
    .prepare(
      "INSERT INTO events (date, start_time, end_time, title, source, deeplink) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.date,
      input.start_time ?? null,
      input.end_time ?? null,
      input.title,
      input.source ?? "manual",
      input.deeplink ?? null,
    );
  return rowToEvent(
    db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid) as EventRow,
  );
}

export function deleteEvent(id: number): boolean {
  return db.prepare("DELETE FROM events WHERE id = ?").run(id).changes > 0;
}

// Sync helper: replace all events from an external source within a date
// window in one transaction. Manual events are untouched.
export function replaceSourceEvents(
  source: string,
  from: string,
  to: string,
  events: Omit<CalendarEvent, "id" | "source">[],
): number {
  const del = db.prepare(
    "DELETE FROM events WHERE source = ? AND date BETWEEN ? AND ?",
  );
  const ins = db.prepare(
    "INSERT INTO events (date, start_time, end_time, title, source, deeplink) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    del.run(source, from, to);
    for (const e of events) {
      ins.run(e.date, e.start_time, e.end_time, e.title, source, e.deeplink);
    }
  })();
  return events.length;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

export function buildTodayView(settings: Settings): TodayView {
  const now = new Date();
  const hour = now.getHours();
  const face: "morning" | "evening" =
    hour >= settings.voice.morning_start_hour &&
    hour < settings.voice.evening_start_hour
      ? "morning"
      : "evening";

  const open = listOpenItems();
  const urgent = open.filter((i) => i.tag === settings.tags.urgent).length;
  const carried = open.filter((i) => i.status === "carried");

  const lastMeal = lastSignalOfType("meal");
  const lastBike = lastSignalOfType("bike");
  const lastOcean = lastSignalOfType("ocean");
  const lastSleep = lastSignalOfType("sleep");
  const hoursSinceMeal = hoursSince(lastMeal?.timestamp ?? null);

  const yesterday = shift(todayISO(), -1);
  const yesterdayStop = getStop(yesterday);

  const promptGentle =
    "What is one small thing that felt alive today?";
  const promptDirect = "What actually moved today — and what didn't?";
  const reflection_prompt =
    face === "evening"
      ? settings.voice.reflection_style === "direct"
        ? promptDirect
        : promptGentle
      : null;

  return {
    date: todayISO(),
    face,
    direction: getLatestDirection(),
    caught: { items: open, urgent_count: urgent, carried },
    body: {
      signals: recentSignals(48),
      hours_since_meal: hoursSinceMeal,
      meal_alert:
        hoursSinceMeal !== null && hoursSinceMeal >= settings.body.meal_alert_hours,
      last_bike: lastBike?.timestamp ?? null,
      last_ocean: lastOcean?.timestamp ?? null,
      last_sleep_hours: lastSleep?.note ? Number(lastSleep.note) || null : null,
    },
    journal: {
      yesterday_excerpt: yesterdayStop?.summary ?? null,
      today_deeplink: `heptabase://journal/${todayISO()}`,
    },
    reflection_prompt,
  };
}
