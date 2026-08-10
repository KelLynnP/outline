export interface Settings {
  sections: {
    caught: boolean;
    body: boolean;
    journal_excerpt: boolean;
    future_stops: boolean;
  };
  line: {
    recent_stops: number;
    months_visible: number;
    month_color_mode: "fixed" | "derived";
  };
  calendar: {
    week_starts_on: "sunday" | "monday";
  };
  body: {
    tracked: {
      meals: boolean;
      bike: boolean;
      ocean: boolean;
      sleep: boolean;
    };
    meal_alert_hours: number;
  };
  tags: {
    normal: string;
    urgent: string;
    question: string;
    date_syntax: string;
  };
  voice: {
    morning_start_hour: number;
    evening_start_hour: number;
    reflection_style: "gentle" | "direct";
  };
  sources: {
    heptabase: boolean;
    strava: boolean;
    calendar: boolean;
    garmin: boolean;
    doordash: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  sections: {
    caught: true,
    body: true,
    journal_excerpt: true,
    future_stops: true,
  },
  line: {
    recent_stops: 14,
    months_visible: 3,
    month_color_mode: "fixed",
  },
  calendar: {
    week_starts_on: "sunday",
  },
  body: {
    tracked: { meals: true, bike: true, ocean: true, sleep: true },
    meal_alert_hours: 5,
  },
  tags: {
    normal: "#c",
    urgent: "#c!",
    question: "#c?",
    date_syntax: "@YYYY-MM-DD",
  },
  voice: {
    morning_start_hour: 5,
    evening_start_hour: 17,
    reflection_style: "gentle",
  },
  sources: {
    heptabase: false,
    strava: false,
    calendar: false,
    garmin: false,
    doordash: false,
  },
};
