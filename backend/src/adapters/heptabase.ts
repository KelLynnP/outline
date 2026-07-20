import type { JournalDay, SourceAdapter, TodoItem } from "./types.js";
import { readSettings } from "../settings.js";

// Phase 2 adapter. Backend calls Anthropic Messages API with the Heptabase
// MCP attached via `mcp_servers`, so extraction + synthesis happen in one
// Claude call. See heptabase-integration-reference.md.
//
// Env:
//   ANTHROPIC_API_KEY
//   HEPTABASE_MCP_URL (default: https://api.heptabase.com/mcp)
//   HEPTABASE_OAUTH_TOKEN
//
// Turning on: set sources.heptabase = true in settings.json.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

async function callClaudeWithHeptabase(
  system: string,
  messages: AnthropicMessage[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const mcpUrl = process.env.HEPTABASE_MCP_URL ?? "https://api.heptabase.com/mcp";
  const token = process.env.HEPTABASE_OAUTH_TOKEN;
  if (!apiKey || !token) throw new Error("missing anthropic or heptabase creds");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages,
      mcp_servers: [
        {
          type: "url",
          url: mcpUrl,
          name: "heptabase",
          authorization_token: token,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

export const heptabase: SourceAdapter = {
  name: "heptabase",
  enabled() {
    return (
      readSettings().sources.heptabase &&
      !!process.env.HEPTABASE_OAUTH_TOKEN &&
      !!process.env.ANTHROPIC_API_KEY
    );
  },

  async fetchJournalRange(from, to): Promise<JournalDay[]> {
    const raw = await callClaudeWithHeptabase(
      "You are a synthesis assistant. Use the heptabase MCP to gather journal entries and reply ONLY with a JSON array. Each item: {\"date\":\"YYYY-MM-DD\",\"excerpt\":\"one short sentence, past tense, no first person\",\"deeplink\":\"the heptabase url for that day\"}. Do not include markdown fences.",
      [
        {
          role: "user",
          content: `Call get_journal_range for ${from} to ${to}. For each day with content, produce one summary sentence for the console's timeline. Return the JSON array only.`,
        },
      ],
    );
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
      return JSON.parse(cleaned) as JournalDay[];
    } catch {
      return [];
    }
  },

  async fetchOpenTodos(tag): Promise<TodoItem[]> {
    const raw = await callClaudeWithHeptabase(
      'You extract open todos from Heptabase. Card content is markdown: a todo is a checkbox list item ("- [ ]" unchecked, "- [x]" done). Never treat headings (lines starting with #), plain bullets, or prose as todos. Reply ONLY with a JSON array, no markdown fences. Each item: {"text":"the todo text","card_title":"title of the card it lives on","deeplink":"heptabase url for that card, or null"}.',
      [
        {
          role: "user",
          content: `Use semantic_search_objects to find cards tagged ${tag} (the tag appears as "${tag}" in the card). Read each hit with get_object and collect every UNCHECKED checkbox item. Skip cards that merely mention the word without the tag. Return the JSON array only.`,
        },
      ],
    );
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
      return JSON.parse(cleaned) as TodoItem[];
    } catch {
      return [];
    }
  },

  async appendToTodayJournal(line: string) {
    await callClaudeWithHeptabase(
      "You append a single line to today's heptabase journal via the append_to_journal tool. Do not add commentary.",
      [{ role: "user", content: `Append this line to today's journal: ${line}` }],
    );
  },

  async saveToInbox(text: string) {
    const raw = await callClaudeWithHeptabase(
      "You save a short note to heptabase's inbox via save_to_note_card and reply ONLY with a JSON object {\"deeplink\":\"...\"}.",
      [{ role: "user", content: `Save this to the inbox and return the deeplink: ${text}` }],
    );
    try {
      return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return null;
    }
  },
};

export async function generateDirectionSentence(): Promise<string | null> {
  if (!heptabase.enabled()) return null;
  try {
    return await callClaudeWithHeptabase(
      "You write ONE serif-worthy sentence, present tense, no first person, no quotes, no markdown. It sets a felt direction for the week. Keep it under 18 words.",
      [
        {
          role: "user",
          content:
            "Read the goals whiteboard via get_whiteboard_with_objects and skim the last 14 days of journals via get_journal_range. Return one sentence.",
        },
      ],
    );
  } catch (e) {
    console.error("direction synthesis", e);
    return null;
  }
}
