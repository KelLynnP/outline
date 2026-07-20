import type { SleepEvent, SourceAdapter } from "./types.js";
import { readSettings } from "../settings.js";

export const garmin: SourceAdapter = {
  name: "garmin",
  enabled() {
    return readSettings().sources.garmin;
  },
  async fetchSleep(_from: string, _to: string): Promise<SleepEvent[]> {
    return [];
  },
};
