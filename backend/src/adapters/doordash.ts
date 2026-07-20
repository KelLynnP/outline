import type { MealEvent, SourceAdapter } from "./types.js";
import { readSettings } from "../settings.js";

export const doordash: SourceAdapter = {
  name: "doordash",
  enabled() {
    return readSettings().sources.doordash;
  },
  async fetchRecentMeals(_days: number): Promise<MealEvent[]> {
    return [];
  },
};
