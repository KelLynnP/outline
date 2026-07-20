import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "console.db");
export const SETTINGS_PATH = path.join(REPO_ROOT, "settings.json");

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
