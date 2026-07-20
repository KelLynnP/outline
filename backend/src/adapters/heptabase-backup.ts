import fs from "node:fs";
import path from "node:path";
import type { TodoItem } from "./types.js";

// Private alternative to the Claude+MCP fetchOpenTodos: parse a local
// Heptabase backup export (markdown files) — no network, no AI. Point
// HEPTABASE_BACKUP_DIR at the export folder. Freshness = last export.

export function backupDir(): string | null {
  const dir = process.env.HEPTABASE_BACKUP_DIR;
  return dir && fs.existsSync(dir) ? dir : null;
}

function* walkMarkdown(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMarkdown(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

export function fetchOpenTodosFromBackup(tag: string): TodoItem[] {
  const dir = backupDir();
  if (!dir) return [];
  // Word boundary so "#todo" doesn't match "#todos".
  const tagRe = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
  const out: TodoItem[] = [];
  for (const file of walkMarkdown(dir)) {
    const text = fs.readFileSync(file, "utf8");
    if (!tagRe.test(text)) continue;
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*[-*]\s+\[ \]\s+(.+)/);
      if (m) {
        out.push({
          text: m[1].trim(),
          card_title: path.basename(file, ".md"),
          deeplink: null,
        });
      }
    }
  }
  return out;
}
