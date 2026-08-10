import fs from "node:fs";
import { DEFAULT_SETTINGS, type Settings } from "@life-console/shared";
import { SETTINGS_PATH } from "./paths.js";

function deepMerge<T>(base: T, override: unknown): T {
  if (
    typeof base !== "object" ||
    base === null ||
    typeof override !== "object" ||
    override === null ||
    Array.isArray(base)
  ) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    out[key] = deepMerge(
      (base as Record<string, unknown>)[key],
      (override as Record<string, unknown>)[key],
    );
  }
  return out as T;
}

export function readSettings(): Settings {
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return deepMerge(DEFAULT_SETTINGS, raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}