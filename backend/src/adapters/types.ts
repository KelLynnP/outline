import type { RoadmapEntry } from "@life-console/shared";

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

export interface LinearIssue {
  external_id: string; // Linear issue UUID
  identifier: string; // "NON-123"
  team: string; // team key
  title: string;
  description: string | null; // markdown body
  assignee: string | null; // display name
  due_date: string | null; // YYYY-MM-DD
  priority: number; // Linear scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low
  url: string;
  state: string | null; // workflow state name, e.g. "Backlog", "In Progress"
  state_type: string | null; // backlog | unstarted | started | triage
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
  publishRoadmap?(
    entries: RoadmapEntry[],
    dryRun: boolean,
  ): Promise<{ created: number; updated: number; deleted: number; dry_run: boolean }>;
  fetchSleep?(from: string, to: string): Promise<SleepEvent[]>;
  fetchRecentMeals?(days: number): Promise<MealEvent[]>;
  fetchLinearIssues?(): Promise<LinearIssue[]>;
}
