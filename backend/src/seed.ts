import { db } from "./db.js";

const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString();
const shift = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};

// Never delete synced calendar events — they're real data. Only clear
// sample-able tables and locally created task/manual events.
db.exec(
  "DELETE FROM items; DELETE FROM signals; DELETE FROM stops; DELETE FROM direction; DELETE FROM events WHERE source IN ('manual','task');",
);

// No fake daily narratives, no fake events. Calendar comes from the google
// adapter; day summaries come from real writing. Kept a handful of open
// tasks so drag-drop + priorities have something to bite on immediately.

const items: {
  text: string;
  tag: string;
  captured: number;
  due?: number | null;
  status?: "open" | "closed" | "carried";
  priority: 1 | 2 | 3;
  tags: string[];
}[] = [
  { text: "follow up with Param on the memo", tag: "#c", captured: -2, status: "carried", priority: 2, tags: ["work"] },
  { text: "review Q4 forecast with finance", tag: "#c!", captured: -1, due: 2, priority: 1, tags: ["work", "finance"] },
  { text: "book flight for offsite", tag: "#c", captured: -3, due: 30, priority: 2, tags: ["work", "travel"] },
  { text: "reply to Mira", tag: "#c", captured: 0, due: 1, priority: 2, tags: ["personal"] },
  { text: "prep for board update", tag: "#c!", captured: 0, due: 3, priority: 1, tags: ["work"] },
];

const insertItem = db.prepare(
  `INSERT INTO items (text, tag, captured_date, due_date, status, source_deeplink, priority, tags)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const it of items) {
  insertItem.run(
    it.text,
    it.tag,
    ymd(shift(it.captured)),
    it.due != null ? ymd(shift(it.due)) : null,
    it.status ?? "open",
    null,
    it.priority,
    it.tags.join(","),
  );
}

const now = new Date();
const insertSignal = db.prepare(
  "INSERT INTO signals (type, timestamp, source, note) VALUES (?, ?, ?, ?)",
);
const meals = [-1.5, -6];
for (const hoursAgo of meals) {
  const ts = new Date(now.getTime() + hoursAgo * 3600_000);
  insertSignal.run("meal", iso(ts), "tap", null);
}
insertSignal.run("bike", iso(new Date(now.getTime() - 26 * 3600_000)), "strava", null);
insertSignal.run("sleep", iso(new Date(now.getTime() - 10 * 3600_000)), "garmin", "7.8");

console.log("seeded", { items: items.length });
