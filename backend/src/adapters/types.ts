export interface AdapterContext {
  now: Date;
}

export interface JournalDay {
  date: string;
  excerpt: string;
  deeplink: string;
}

export interface RideEvent {
  date: string;
  distance_km: number;
  duration_min: number;
  deeplink: string;
}

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM, null = all-day
  end_time: string | null; // HH:MM
  title: string;
  deeplink: string | null;
  source?: string;
  external_id?: string;
  location?: string | null;
  description?: string | null;
  attendees?: {
    name: string | null;
    email: string | null;
    status: string | null;
    self?: boolean;
  }[];
}

export interface SleepEvent {
  date: string;
  hours: number;
}

export interface TodoItem {
  text: string;
  card_title: string;
  deeplink: string | null;
}

export interface MealEvent {
  timestamp: string;
  label: string;
  deeplink: string | null;
}

export interface SourceAdapter {
  name: string;
  enabled(): boolean;

  fetchJournalRange?(from: string, to: string): Promise<JournalDay[]>;
  fetchOpenTodos?(tag: string): Promise<TodoItem[]>;
  appendToTodayJournal?(line: string): Promise<void>;
  saveToInbox?(text: string): Promise<{ deeplink: string } | null>;

  fetchRecentRides?(days: number): Promise<RideEvent[]>;
  fetchUpcomingEvents?(days: number): Promise<CalendarEvent[]>;
  fetchEventsRange?(from: string, to: string): Promise<CalendarEvent[]>;
  confirmEvent?(externalId: string): Promise<void>;
  rejectEvent?(externalId: string): Promise<void>;
  fetchSleep?(from: string, to: string): Promise<SleepEvent[]>;
  fetchRecentMeals?(days: number): Promise<MealEvent[]>;
}
