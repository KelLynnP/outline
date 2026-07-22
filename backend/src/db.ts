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

  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  CREATE INDEX IF NOT EXISTS idx_items_due ON items(due_date);
  CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
`);

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
ensureColumn("stops", "notes", "notes TEXT");
ensureColumn("events", "item_id", "item_id INTEGER");
ensureColumn("events", "status", "status TEXT");
ensureColumn("events", "external_id", "external_id TEXT");
ensureColumn("events", "location", "location TEXT");
ensureColumn("events", "description", "description TEXT");
ensureColumn("events", "attendees", "attendees TEXT");
ensureColumn("events", "hue", "hue INTEGER"); // user-picked color for manual events
ensureColumn("events", "end_date", "end_date TEXT"); // multi-day span (all-day events)
