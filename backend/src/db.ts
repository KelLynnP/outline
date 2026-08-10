import Database from "better-sqlite3";
import { DB_PATH, ensureDataDir } from "./paths.js";

ensureDataDir();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    tag TEXT NOT NULL,
    captured_date TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    source_deeplink TEXT,
    closed_date TEXT,
    priority INTEGER NOT NULL DEFAULT 2,
    tags TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stops (
    date TEXT PRIMARY KEY,
    summary TEXT,
    journal_deeplink TEXT,
    enrichment TEXT,
    notes TEXT
  );

  -- week/month/year notes; day notes live in stops.notes.
  -- key: "week-YYYY-MM-DD" (configured week start), "month-YYYY-MM", "year-YYYY"
  CREATE TABLE IF NOT EXISTS period_notes (
    key TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS direction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    deeplink TEXT,
    item_id INTEGER,
    status TEXT,
    external_id TEXT
  );

  CREATE TABLE IF NOT EXISTS roadmap_lanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#547a68',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS roadmap_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lane_id INTEGER NOT NULL REFERENCES roadmap_lanes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('span', 'milestone')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    notes TEXT,
    theme TEXT,
    color TEXT NOT NULL DEFAULT '#547a68',
    row_position INTEGER,
    transparent INTEGER NOT NULL DEFAULT 0,
    opacity REAL NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  CREATE INDEX IF NOT EXISTS idx_items_due ON items(due_date);
  CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
  CREATE INDEX IF NOT EXISTS idx_roadmap_entries_dates
    ON roadmap_entries(start_date, end_date);
`);

if (
  !(db.prepare("SELECT id FROM roadmap_lanes LIMIT 1").get() as
    | { id: number }
    | undefined)
) {
  db.prepare(
    "INSERT INTO roadmap_lanes (name, color, position) VALUES (?, ?, 0)",
  ).run("Focus", "#547a68");
}

function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("items", "priority", "priority INTEGER NOT NULL DEFAULT 2");
ensureColumn("items", "tags", "tags TEXT NOT NULL DEFAULT ''");
ensureColumn("items", "assignee", "assignee TEXT"); // free-text @person, internal only
ensureColumn("items", "parent_id", "parent_id INTEGER"); // nest under another item (project)
ensureColumn("items", "kind", "kind TEXT NOT NULL DEFAULT 'task'"); // task | note (freeform, uncheckable)
ensureColumn("items", "description", "description TEXT"); // longer body under the title (linear-style)
ensureColumn("items", "source", "source TEXT NOT NULL DEFAULT 'manual'"); // manual | linear
ensureColumn("items", "external_id", "external_id TEXT"); // linear issue UUID (sync upsert key)
ensureColumn("items", "linear_identifier", "linear_identifier TEXT"); // "NON-123"
ensureColumn("items", "linear_team", "linear_team TEXT"); // team key
ensureColumn("items", "linear_state", "linear_state TEXT"); // workflow state name
ensureColumn("stops", "notes", "notes TEXT");
ensureColumn("events", "item_id", "item_id INTEGER");
ensureColumn("events", "status", "status TEXT");
ensureColumn("events", "external_id", "external_id TEXT");
ensureColumn("events", "location", "location TEXT");
ensureColumn("events", "description", "description TEXT");
ensureColumn("events", "attendees", "attendees TEXT");
ensureColumn("events", "hue", "hue INTEGER"); // user-picked color for manual events
ensureColumn("events", "end_date", "end_date TEXT"); // multi-day span (all-day events)
ensureColumn("roadmap_entries", "theme", "theme TEXT");
ensureColumn(
  "roadmap_entries",
  "color",
  "color TEXT NOT NULL DEFAULT '#547a68'",
);
ensureColumn("roadmap_entries", "row_position", "row_position INTEGER");
ensureColumn(
  "roadmap_entries",
  "transparent",
  "transparent INTEGER NOT NULL DEFAULT 0",
);
ensureColumn(
  "roadmap_entries",
  "opacity",
  "opacity REAL NOT NULL DEFAULT 1",
);
ensureColumn(
  "roadmap_entries",
  "published",
  "published INTEGER NOT NULL DEFAULT 0",
);
