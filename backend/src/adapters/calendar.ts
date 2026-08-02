import type { CalendarEvent, SourceAdapter } from "./types.js";
import type { RoadmapEntry } from "@life-console/shared";
import { readSettings } from "../settings.js";

// Google Calendar via OAuth (read-only scope). LIVE — do not stub this out;
// see AGENTS.md → "calendar integration status".
//
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// (mint with `npm run auth:google --workspace backend`), optional
// GOOGLE_CALENDAR_ID (defaults to "primary"). Toggle via settings.json →
// sources.calendar. runCalendarSync (synthesis.ts) writes results into the
// events table hourly and via POST /api/sync/calendar.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getAccessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  eventType?: string;
  location?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: {
    displayName?: string;
    email?: string;
    responseStatus?: string;
    self?: boolean;
  }[];
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

/** Google often sends HTML in description; keep the detail panel readable. */
function plainText(html: string | undefined): string | null {
  if (!html?.trim()) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

// Google emits pseudo-events for working location ("Office"), out-of-office
// blocks, and focus time. They aren't meetings; keep them off the console.
const SKIPPED_EVENT_TYPES = new Set(["workingLocation", "outOfOffice", "focusTime"]);

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function fetchRange(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const token = await getAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true"); // expand recurring events
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`google events fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { items?: GoogleEvent[] };

  const out: CalendarEvent[] = [];
  for (const e of json.items ?? []) {
    if (e.status === "cancelled" || !e.start) continue;
    if (e.eventType && SKIPPED_EVENT_TYPES.has(e.eventType)) continue;
    const title = e.summary?.trim() || "(untitled)";
    // Fallback: working-location events sometimes omit eventType; titles are
    // typically just "Office" / "Home" / "Elsewhere".
    if (/^(office|home|elsewhere)$/i.test(title)) continue;
    const attendees = (e.attendees ?? []).map((a) => ({
      name: a.displayName?.trim() || null,
      email: a.email ?? null,
      status: a.responseStatus ?? null,
      self: a.self === true,
    }));
    const base = {
      title,
      deeplink: e.htmlLink ?? null,
      source: "google",
      external_id: e.id,
      location: e.location?.trim() || null,
      description: plainText(e.description),
      attendees,
    };
    if (e.start.date) {
      // all-day
      out.push({ ...base, date: e.start.date, start_time: null, end_time: null });
    } else if (e.start.dateTime) {
      const s = new Date(e.start.dateTime);
      const en = e.end?.dateTime ? new Date(e.end.dateTime) : null;
      out.push({
        ...base,
        date: localDate(s),
        start_time: localTime(s),
        end_time: en ? localTime(en) : null,
      });
    }
  }
  return out;
}

const EXPORT_SOURCE_KEY = "lifeConsoleSource";
const EXPORT_SOURCE_VALUE = "roadmap";
const EXPORT_ENTRY_KEY = "roadmapEntryId";

const addDay = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

function roadmapPayload(entry: RoadmapEntry) {
  return {
    summary: entry.title,
    start: { date: entry.start_date },
    end: { date: addDay(entry.end_date ?? entry.start_date) },
    extendedProperties: {
      private: {
        [EXPORT_SOURCE_KEY]: EXPORT_SOURCE_VALUE,
        [EXPORT_ENTRY_KEY]: String(entry.id),
      },
    },
  };
}

async function listPublishedEvents(
  token: string,
  calendarId: string,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set(
      "privateExtendedProperty",
      `${EXPORT_SOURCE_KEY}=${EXPORT_SOURCE_VALUE}`,
    );
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`google export fetch failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return events;
}

async function publishRoadmap(entries: RoadmapEntry[], dryRun: boolean) {
  const calendarId = process.env.GOOGLE_EXPORT_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_EXPORT_CALENDAR_ID is not set");
  const token = await getAccessToken();
  const remote = await listPublishedEvents(token, calendarId);
  const byEntryId = new Map<string, GoogleEvent[]>();
  for (const event of remote) {
    const entryId = event.extendedProperties?.private?.[EXPORT_ENTRY_KEY];
    if (!entryId) continue;
    byEntryId.set(entryId, [...(byEntryId.get(entryId) ?? []), event]);
  }

  const creates: RoadmapEntry[] = [];
  const updates: { entry: RoadmapEntry; event: GoogleEvent }[] = [];
  const deletes: GoogleEvent[] = [];
  for (const entry of entries) {
    const matches = byEntryId.get(String(entry.id)) ?? [];
    const event = matches.shift();
    if (!event) {
      creates.push(entry);
    } else {
      const desired = roadmapPayload(entry);
      if (
        event.summary !== desired.summary ||
        event.start?.date !== desired.start.date ||
        event.end?.date !== desired.end.date
      ) {
        updates.push({ entry, event });
      }
    }
    deletes.push(...matches);
    byEntryId.delete(String(entry.id));
  }
  for (const leftovers of byEntryId.values()) deletes.push(...leftovers);

  const result = {
    created: creates.length,
    updated: updates.length,
    deleted: deletes.length,
    dry_run: dryRun,
  };
  if (dryRun) return result;

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const write = async (url: string, method: string, body?: unknown) => {
    const target = new URL(url);
    target.searchParams.set("sendUpdates", "none");
    const res = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`google export ${method} failed: ${res.status} ${await res.text()}`);
    }
  };
  for (const entry of creates) await write(base, "POST", roadmapPayload(entry));
  for (const { entry, event } of updates) {
    if (event.id) {
      await write(`${base}/${encodeURIComponent(event.id)}`, "PATCH", roadmapPayload(entry));
    }
  }
  for (const event of deletes) {
    if (event.id) await write(`${base}/${encodeURIComponent(event.id)}`, "DELETE");
  }
  return result;
}

export const calendar: SourceAdapter = {
  name: "calendar",
  enabled() {
    return (
      readSettings().sources.calendar &&
      Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_REFRESH_TOKEN,
      )
    );
  },
  async fetchUpcomingEvents(days: number): Promise<CalendarEvent[]> {
    const now = new Date();
    return fetchRange(now, new Date(now.getTime() + days * 86400_000));
  },
  async fetchEventsRange(from: string, to: string): Promise<CalendarEvent[]> {
    return fetchRange(new Date(from + "T00:00:00"), new Date(to + "T23:59:59"));
  },

  publishRoadmap,

  // Called when the user hits ✓ on a real calendar event.
  // Google Calendar RSVP requires knowing which attendee is "me" and patching
  // that attendee's `responseStatus` to "accepted". For a single-owner console
  // this typically means: PATCH /events/{id} with attendees[].self.responseStatus.
  // Left as a TODO — event status is stored locally either way, so this can
  // be wired incrementally.
  async confirmEvent(_externalId: string): Promise<void> {
    // TODO: PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{externalId}
    //   body: { attendees: [{ email: OWNER_EMAIL, responseStatus: "accepted" }] }
    return;
  },

  // Called when the user hits ✗ on a real calendar event.
  // For a "decline" (keep the event but mark you as not going), PATCH with
  // responseStatus="declined". For a "delete the calendar entry" flow, use
  // DELETE /events/{id}. Pick per your preference.
  async rejectEvent(_externalId: string): Promise<void> {
    // TODO: same PATCH as above with responseStatus="declined", or DELETE.
    return;
  },
};
