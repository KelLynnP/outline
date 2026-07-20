import type { CalendarEvent, SourceAdapter } from "./types.js";
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
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

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
    const title = e.summary?.trim() || "(untitled)";
    const base = {
      title,
      deeplink: e.htmlLink ?? null,
      source: "google",
      external_id: e.id,
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
};
