export type CatchTag = string;

export type ItemStatus = "open" | "closed" | "carried";

export type Priority = 1 | 2 | 3;

export interface CaughtItem {
  id: number;
  text: string;
  tag: CatchTag;
  captured_date: string; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD or null
  status: ItemStatus;
  source_deeplink: string | null;
  closed_date: string | null;
  priority: Priority;
  tags: string[];
  // Free-text person name (no directory yet) — for team deadlines / load.
  assignee: string | null;
  // Nesting: project tasks are parents; null = top-level.
  parent_id: number | null;
  // "note" = freeform thought, no checkbox, never shows in done.
  kind: "task" | "note";
  // Set when a "task" calendar event exists for this item (see listAllItems).
  scheduled_date?: string | null; // YYYY-MM-DD
  scheduled_time?: string | null; // HH:MM
}

export type EventStatus = "pending" | "confirmed" | null;

export interface EventAttendee {
  name: string | null;
  email: string | null;
  status: string | null; // accepted | declined | tentative | needsAction
  self?: boolean;
}

export interface CalendarEvent {
  id: number;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM
  end_time: string | null; // HH:MM
  title: string;
  source: string; // "manual" | "task" | "calendar" | "google" | ...
  deeplink: string | null;
  item_id: number | null; // set when source === "task"
  status: EventStatus;
  external_id: string | null;
  location: string | null;
  description: string | null;
  attendees: EventAttendee[];
  // First tag of the linked task (task events only) — used for color coding.
  item_tag?: string | null;
  // User-picked hue (0-360) for manual events.
  hue?: number | null;
  // Multi-day all-day span: last day inclusive (null = single day).
  end_date?: string | null;
}

export interface RoadmapLane {
  id: number;
  name: string;
  position: number;
}

export interface RoadmapEntry {
  id: number;
  lane_id: number;
  title: string;
  kind: "span" | "milestone";
  start_date: string; // YYYY-MM-DD
  end_date: string | null; // inclusive; null for milestones
  notes: string | null;
  theme: string | null;
  color: string;
  row_position: number | null;
  transparent: boolean;
  opacity: number;
  published: boolean;
}

export type SignalType = "meal" | "bike" | "ocean" | "sleep";

export interface BodySignal {
  id: number;
  type: SignalType;
  timestamp: string; // ISO
  source: "tap" | "journal" | "strava" | "garmin";
  note: string | null;
}

export interface Stop {
  date: string; // YYYY-MM-DD
  summary: string | null;
  journal_deeplink: string | null;
  enrichment: Record<string, unknown> | null;
  notes: string | null;
}

export interface DirectionSentence {
  sentence: string;
  generated_at: string; // ISO
}

export interface TodayView {
  date: string;
  face: "morning" | "evening";
  direction: DirectionSentence | null;
  caught: {
    items: CaughtItem[];
    urgent_count: number;
    carried: CaughtItem[];
  };
  body: {
    signals: BodySignal[];
    hours_since_meal: number | null;
    meal_alert: boolean;
    last_bike: string | null;
    last_ocean: string | null;
    last_sleep_hours: number | null;
  };
  journal: {
    yesterday_excerpt: string | null;
    today_deeplink: string;
  };
  reflection_prompt: string | null;
}

export interface LineView {
  today: string;
  months: { key: string; label: string; hue: string }[];
  stops: Stop[]; // recent detailed stops
  dots: string[]; // older compressed days
  future_stops: {
    date: string;
    text: string;
    tag: CatchTag;
  }[];
}
