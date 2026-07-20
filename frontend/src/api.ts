import type {
  BodySignal,
  CalendarEvent,
  CaughtItem,
  LineView,
  Priority,
  Settings,
  Stop,
  TodayView,
} from "@life-console/shared";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  line: () => fetch("/api/line").then((r) => j<LineView>(r)),
  today: () => fetch("/api/today").then((r) => j<TodayView>(r)),
  stop: (date: string) => fetch(`/api/stops/${date}`).then((r) => j<Stop>(r)),
  saveNotes: (date: string, notes: string) =>
    fetch(`/api/stops/${date}/notes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).then((r) => j<Stop>(r)),
  allItems: () => fetch("/api/items/all").then((r) => j<CaughtItem[]>(r)),
  addItem: (body: {
    text: string;
    tag?: string;
    due_date?: string | null;
    priority?: Priority;
    tags?: string[];
  }) =>
    fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<CaughtItem>(r)),
  updateItem: (
    id: number,
    patch: {
      text?: string;
      tag?: string;
      due_date?: string | null;
      priority?: Priority;
      tags?: string[];
    },
  ) =>
    fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j<CaughtItem>(r)),
  closeItem: (id: number) =>
    fetch(`/api/items/${id}/close`, { method: "POST" }).then((r) => j<CaughtItem>(r)),
  carryItem: (id: number) =>
    fetch(`/api/items/${id}/carry`, { method: "POST" }).then((r) => j<CaughtItem>(r)),
  events: (date?: string) =>
    fetch(`/api/events${date ? `?date=${date}` : ""}`).then((r) => j<CalendarEvent[]>(r)),
  addEvent: (body: {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    title: string;
  }) =>
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<CalendarEvent>(r)),
  deleteEvent: (id: number) =>
    fetch(`/api/events/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  logSignal: (body: {
    type: BodySignal["type"];
    timestamp?: string;
    note?: string;
  }) =>
    fetch("/api/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<BodySignal>(r)),
  settings: () => fetch("/api/settings").then((r) => j<Settings>(r)),
  saveSettings: (partial: unknown) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(partial),
    }).then((r) => j<Settings>(r)),
};
