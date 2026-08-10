import type {
  BodySignal,
  CalendarEvent,
  CaughtItem,
  LinearTeam,
  LineView,
  Priority,
  RoadmapEntry,
  RoadmapLane,
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
  // key: "YYYY-MM-DD" | "week-YYYY-MM-DD" (configured week start) | "month-YYYY-MM"
  notes: (key: string) =>
    fetch(`/api/notes/${key}`).then((r) => j<{ key: string; notes: string }>(r)),
  saveNotes: (key: string, notes: string) =>
    fetch(`/api/notes/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).then((r) => j<{ key: string; notes: string }>(r)),
  allItems: () => fetch("/api/items/all").then((r) => j<CaughtItem[]>(r)),
  addItem: (body: {
    text: string;
    tag?: string;
    due_date?: string | null;
    priority?: Priority;
    tags?: string[];
    assignee?: string | null;
    parent_id?: number | null;
    kind?: "task" | "note";
    description?: string | null;
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
      assignee?: string | null;
      parent_id?: number | null;
      description?: string | null;
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
  reopenItem: (id: number) =>
    fetch(`/api/items/${id}/reopen`, { method: "POST" }).then((r) => j<CaughtItem>(r)),
  linearTeams: () => fetch("/api/linear/teams").then((r) => j<LinearTeam[]>(r)),
  sendToLinear: (
    id: number,
    body: {
      team_id: string;
      assignee_id?: string | null;
      priority?: number; // Linear scale 0-4
      description?: string | null;
    },
  ) =>
    fetch(`/api/items/${id}/linear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<CaughtItem>(r)),
  detachLinear: (id: number) =>
    fetch(`/api/items/${id}/linear`, { method: "DELETE" }).then((r) =>
      j<CaughtItem>(r),
    ),
  setLinearState: (id: number, type: "backlog" | "unstarted" | "started") =>
    fetch(`/api/items/${id}/linear-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    }).then((r) => j<CaughtItem>(r)),
  newLinearIssue: (body: {
    team_id: string;
    title: string;
    description?: string | null;
    assignee_id?: string | null;
    priority?: number; // Linear scale 0-4
    due_date?: string | null;
  }) =>
    fetch("/api/linear/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<CaughtItem>(r)),
  syncLinear: () =>
    fetch("/api/sync/linear", { method: "POST" }).then((r) =>
      j<{ ok: boolean; created: number; updated: number; closed: number }>(r),
    ),
  unscheduleItem: (id: number) =>
    fetch(`/api/items/${id}/schedule`, { method: "DELETE" }).then((r) =>
      j<{ removed: number }>(r),
    ),
  events: (date?: string) =>
    fetch(`/api/events${date ? `?date=${date}` : ""}`).then((r) => j<CalendarEvent[]>(r)),
  addEvent: (body: {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    end_date?: string | null;
    title: string;
    source?: string;
    item_id?: number | null;
    status?: "pending" | "confirmed" | null;
    deeplink?: string | null;
  }) =>
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<CalendarEvent>(r)),
  setEventStatus: (id: number, status: "pending" | "confirmed" | null) =>
    fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).then((r) => j<CalendarEvent>(r)),
  setEventTimes: (
    id: number,
    start_time: string | null,
    end_time: string | null,
    date?: string,
  ) =>
    fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start_time, end_time, ...(date ? { date } : {}) }),
    }).then((r) => j<CalendarEvent>(r)),
  setEventEndDate: (id: number, end_date: string | null) =>
    fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ end_date }),
    }).then((r) => j<CalendarEvent>(r)),
  setEventHue: (id: number, hue: number | null) =>
    fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hue }),
    }).then((r) => j<CalendarEvent>(r)),
  deleteEvent: (id: number) =>
    fetch(`/api/events/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  roadmapLanes: () =>
    fetch("/api/roadmap/lanes").then((r) => j<RoadmapLane[]>(r)),
  addRoadmapLane: (body: { name: string }) =>
    fetch("/api/roadmap/lanes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<RoadmapLane>(r)),
  updateRoadmapLane: (
    id: number,
    patch: Partial<Pick<RoadmapLane, "name" | "position">>,
  ) =>
    fetch(`/api/roadmap/lanes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j<RoadmapLane>(r)),
  deleteRoadmapLane: (id: number) =>
    fetch(`/api/roadmap/lanes/${id}`, { method: "DELETE" }).then((r) =>
      j<{ ok: boolean }>(r),
    ),
  roadmapEntries: (from: string, to: string) =>
    fetch(`/api/roadmap/entries?from=${from}&to=${to}`).then((r) =>
      j<RoadmapEntry[]>(r),
    ),
  addRoadmapEntry: (body: Omit<RoadmapEntry, "id">) =>
    fetch("/api/roadmap/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<RoadmapEntry>(r)),
  updateRoadmapEntry: (id: number, patch: Partial<Omit<RoadmapEntry, "id">>) =>
    fetch(`/api/roadmap/entries/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j<RoadmapEntry>(r)),
  deleteRoadmapEntry: (id: number) =>
    fetch(`/api/roadmap/entries/${id}`, { method: "DELETE" }).then((r) =>
      j<{ ok: boolean }>(r),
    ),
  publishRoadmap: (dryRun: boolean) =>
    fetch("/api/roadmap/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun }),
    }).then((r) =>
      j<{ created: number; updated: number; deleted: number; dry_run: boolean }>(r),
    ),
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
};
