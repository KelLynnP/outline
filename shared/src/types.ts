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
}

export interface CalendarEvent {
  id: number;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM
  end_time: string | null; // HH:MM
  title: string;
  source: string;
  deeplink: string | null;
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
