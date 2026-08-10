import cron from "node-cron";
import { shiftDateISO } from "@life-console/shared";
import { heptabase, generateDirectionSentence } from "./adapters/heptabase.js";
import { calendar } from "./adapters/calendar.js";
import { linear } from "./adapters/linear.js";
import {
  replaceSourceEvents,
  setDirection,
  syncLinearItems,
  upsertStop,
  todayISO,
} from "./queries.js";

// Nightly: generate a one-line summary for each recent day. When Heptabase +
// Anthropic are configured, this will call Claude with the Heptabase MCP
// attached. Until then, it's a no-op — sample stops come from the seed.
export async function runNightlyStopSummaries() {
  if (!heptabase.enabled() || !heptabase.fetchJournalRange) return;
  const to = todayISO();
  const from = shiftDateISO(to, -14);
  const days = await heptabase.fetchJournalRange(from, to);
  for (const d of days) {
    upsertStop({
      date: d.date,
      summary: d.excerpt,
      journal_deeplink: d.deeplink,
      enrichment: null,
      notes: null,
    });
  }
}

// Weekly: regenerate the direction sentence from the goals whiteboard +
// recent journals via the Heptabase MCP + Claude.
export async function runWeeklyDirection() {
  if (!heptabase.enabled()) return;
  const sentence = await generateDirectionSentence();
  if (sentence) setDirection(sentence);
}

// Pull upcoming events from the calendar adapter into the events table.
// Replaces the whole "calendar" source window each run so edits/deletions
// upstream propagate; manual events are never touched.
export async function runCalendarSync(days = 14): Promise<number> {
  if (!calendar.enabled() || !calendar.fetchEventsRange) return 0;
  // Full days from local midnight so today's earlier events survive re-syncs.
  const from = todayISO();
  const to = shiftDateISO(from, days);
  const events = await calendar.fetchEventsRange(from, to);
  // Google returns multi-day events that *started* before the window; keep
  // only rows dated inside it, since rows outside never get replaced.
  const inWindow = events.filter((e) => e.date >= from && e.date <= to);
  return replaceSourceEvents("calendar", from, to, inWindow);
}

// Pull open Linear issues into the items table (upsert by external_id, so
// local edits like nesting/tags survive). Issues gone from the fetch —
// completed, canceled, or out of scope — get closed locally, which is how
// "done in Linear" propagates to the board.
export async function runLinearSync(): Promise<{
  created: number;
  updated: number;
  closed: number;
} | null> {
  if (!linear.enabled() || !linear.fetchLinearIssues) return null;
  return syncLinearItems(await linear.fetchLinearIssues());
}

export function scheduleJobs() {
  // sync once on boot so a fresh/reseeded DB fills immediately
  runCalendarSync().catch((e) => console.error("calendar_sync_boot", e));
  runLinearSync().catch((e) => console.error("linear_sync_boot", e));
  cron.schedule("15 3 * * *", () => {
    runNightlyStopSummaries().catch((e) => console.error("nightly", e));
  });
  cron.schedule("30 4 * * 1", () => {
    runWeeklyDirection().catch((e) => console.error("weekly", e));
  });
  cron.schedule("5 * * * *", () => {
    runCalendarSync().catch((e) => console.error("calendar_sync", e));
  });
  cron.schedule("*/10 * * * *", () => {
    runLinearSync().catch((e) => console.error("linear_sync", e));
  });
}
