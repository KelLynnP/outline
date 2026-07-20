import type { RideEvent, SourceAdapter } from "./types.js";
import { readSettings } from "../settings.js";

export const strava: SourceAdapter = {
  name: "strava",
  enabled() {
    return readSettings().sources.strava;
  },
  async fetchRecentRides(_days: number): Promise<RideEvent[]> {
    return [];
  },
};
