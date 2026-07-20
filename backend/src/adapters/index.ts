export * from "./types.js";
import { heptabase } from "./heptabase.js";
import { strava } from "./strava.js";
import { calendar } from "./calendar.js";
import { garmin } from "./garmin.js";
import { doordash } from "./doordash.js";
import type { SourceAdapter } from "./types.js";

export const adapters: Record<string, SourceAdapter> = {
  heptabase,
  strava,
  calendar,
  garmin,
  doordash,
};

export function enabledAdapters(): SourceAdapter[] {
  return Object.values(adapters).filter((a) => a.enabled());
}
