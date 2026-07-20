import { db } from "./db.js";
import { setDirection, upsertStop } from "./queries.js";

const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString();
const shift = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};

db.exec("DELETE FROM items; DELETE FROM signals; DELETE FROM stops; DELETE FROM direction; DELETE FROM events;");

setDirection(
  "Move at the speed of the body — one strong meeting, one long ride, one honest evening.",
);

const stopLines = [
  "long ride down the coast; two clean hours of work after.",
  "quiet morning. followed up with Param. wrote the framing memo.",
  "meetings all day; forgot lunch until 3.",
  "ocean before work; slept nine hours.",
  "shipped the prototype; ate on time.",
  "reflection day — closed three carried items.",
  "biked the bridge loop. finance review afterward.",
  "flat day. carried two items into tomorrow.",
  "friend in town; late dinner. slow start.",
  "board prep; heavy focus block in the morning.",
  "off. ocean and a long book.",
  "hiring loop; drained by evening.",
  "planning: laid out the next month on paper.",
  "shipped the settings surface.",
  "swim + writing. felt aligned.",
  "budget review. said no to two things.",
  "one deep meeting, then reading.",
  "ride + design review.",
  "closed the loop on the tax filing.",
];

for (let i = 1; i <= 60; i++) {
  const date = ymd(shift(-i));
  const summary = stopLines[i % stopLines.length];
  upsertStop({
    date,
    summary,
    journal_deeplink: `heptabase://journal/${date}`,
    enrichment: null,
  });
}

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
  { text: "renew driver's license", tag: "#c", captured: -6, due: 12, priority: 2, tags: ["admin"] },
  { text: "taxes due", tag: "#c!", captured: -20, due: 21, priority: 1, tags: ["finance", "admin"] },
  { text: "dentist — schedule cleaning", tag: "#c?", captured: -9, priority: 3, tags: ["health"] },
  { text: "book flight for offsite", tag: "#c", captured: -3, due: 30, priority: 2, tags: ["work", "travel"] },
  { text: "return the ocean thermometer", tag: "#c", captured: -4, status: "carried", priority: 3, tags: ["home"] },
  { text: "reply to Mira", tag: "#c", captured: 0, due: 1, priority: 2, tags: ["personal"] },
  { text: "prep for board update", tag: "#c!", captured: 0, due: 3, priority: 1, tags: ["work"] },
  { text: "look into standing desk", tag: "#c?", captured: -14, priority: 3, tags: ["health", "home"] },
  { text: "fix the front bike tire", tag: "#c", captured: -1, priority: 2, tags: ["bike"] },
  { text: "reread the constitution doc", tag: "#c?", captured: -8, priority: 3, tags: ["personal"] },
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

const insertEvent = db.prepare(
  "INSERT INTO events (date, start_time, end_time, title, source, deeplink) VALUES (?, ?, ?, ?, ?, ?)",
);
const events: {
  day: number;
  start: string | null;
  end: string | null;
  title: string;
}[] = [
  { day: 0, start: "08:30", end: "09:00", title: "morning ride" },
  { day: 0, start: "09:30", end: "10:00", title: "1:1 with Param" },
  { day: 0, start: "11:00", end: "12:00", title: "product review" },
  { day: 0, start: "13:00", end: "13:30", title: "lunch" },
  { day: 0, start: "15:00", end: "16:00", title: "focus block: memo" },
  { day: 0, start: "18:00", end: null, title: "dinner w/ Mira" },
  { day: 1, start: "09:00", end: "10:00", title: "board prep" },
  { day: 1, start: "14:00", end: "15:00", title: "finance sync" },
  { day: 2, start: "10:00", end: "11:30", title: "hiring loop" },
  { day: 3, start: "08:00", end: "09:00", title: "swim" },
  { day: 3, start: "13:00", end: "14:00", title: "team lunch" },
  { day: 4, start: null, end: null, title: "offsite (all day)" },
];
for (const e of events) {
  insertEvent.run(ymd(shift(e.day)), e.start, e.end, e.title, "manual", null);
}

const now = new Date();
const insertSignal = db.prepare(
  "INSERT INTO signals (type, timestamp, source, note) VALUES (?, ?, ?, ?)",
);

const meals = [-1.5, -6, -22, -28];
for (const hoursAgo of meals) {
  const ts = new Date(now.getTime() + hoursAgo * 3600_000);
  insertSignal.run("meal", iso(ts), "tap", null);
}
insertSignal.run("bike", iso(new Date(now.getTime() - 26 * 3600_000)), "strava", null);
insertSignal.run("ocean", iso(new Date(now.getTime() - 50 * 3600_000)), "tap", null);
insertSignal.run("sleep", iso(new Date(now.getTime() - 10 * 3600_000)), "garmin", "7.8");
insertSignal.run("sleep", iso(new Date(now.getTime() - 34 * 3600_000)), "garmin", "6.5");

console.log("seeded", { stops: 60, items: items.length });
