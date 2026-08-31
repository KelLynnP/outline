import { useCallback, useEffect, useState } from "react";
import {
  localDateISO,
  type CaughtItem,
  type LineView,
  type Settings,
} from "@life-console/shared";
import { api } from "../api.js";
import { TimelineV2 } from "../components/TimelineV2.js";
import { DailyCalendar } from "../components/DailyCalendar.js";
import { Roadmap } from "../components/Roadmap.js";
import { PeriodNotes } from "../components/PeriodNotes.js";
import { TaskTable } from "../components/Tasks.js";

type Screen = "notes" | "calendar" | "tasks" | "timeline" | "roadmap";

const MODULES: { key: Screen; hint: string }[] = [
  { key: "notes", hint: "blank page for the day" },
  { key: "calendar", hint: "today's schedule" },
  { key: "tasks", hint: "capture + check off" },
  { key: "timeline", hint: "the day spine" },
  { key: "roadmap", hint: "lanes + horizons" },
];

// Phone shell: a launcher home, then one full-screen module at a time.
// Desktop keeps HomePage untouched — App.tsx picks per viewport width.
export function MobilePage() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => localDateISO());
  const [line, setLine] = useState<LineView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<CaughtItem[]>([]);
  const [calVersion, setCalVersion] = useState(0);

  const load = useCallback(async () => {
    const [l, s, i] = await Promise.all([
      api.line(),
      api.settings(),
      api.allItems(),
    ]);
    setLine(l);
    setSettings(s);
    setItems(i);
    setCalVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  if (!line || !settings)
    return <div className="quiet m-loading">loading…</div>;

  if (screen === null) {
    return (
      <div className="mobile m-home">
        <div className="m-home-head">
          <h1>life console</h1>
          <div className="m-home-date">
            {new Date(localDateISO() + "T00:00:00").toLocaleDateString(
              "en-US",
              { weekday: "long", month: "long", day: "numeric" },
            )}
          </div>
        </div>
        <div className="m-modules">
          {MODULES.map((m) => (
            <button
              key={m.key}
              className="m-module"
              onClick={() => setScreen(m.key)}
            >
              <span className="m-module-name">{m.key}</span>
              <span className="m-module-hint">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const shiftDay = (days: number) => {
    const next = new Date(selectedDate + "T00:00:00");
    next.setDate(next.getDate() + days);
    setSelectedDate(localDateISO(next));
  };
  const isToday = selectedDate === localDateISO();
  const dateLabel = isToday
    ? "today"
    : new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
  const dated = screen === "notes" || screen === "calendar";

  return (
    <div className={`mobile m-screen m-${screen}`}>
      <div className="m-bar">
        <button className="m-back" onClick={() => setScreen(null)}>
          ‹
        </button>
        <span className="m-bar-title">{screen}</span>
        {dated && (
          <span className="m-bar-date">
            <button onClick={() => shiftDay(-1)}>‹</button>
            <button
              className="m-bar-day"
              title="jump to today"
              onClick={() => setSelectedDate(localDateISO())}
            >
              {dateLabel}
            </button>
            <button onClick={() => shiftDay(1)}>›</button>
          </span>
        )}
      </div>
      <div className="m-body">
        {screen === "notes" && (
          <PeriodNotes
            date={selectedDate}
            view="day"
            weekStartsOn={settings.calendar.week_starts_on}
          />
        )}
        {screen === "calendar" && (
          <DailyCalendar
            date={selectedDate}
            variant="widget"
            onTaskChange={load}
            refreshKey={calVersion}
          />
        )}
        {screen === "tasks" && (
          <TaskTable items={items} settings={settings} onChange={load} />
        )}
        {screen === "timeline" && (
          <div className="m-timeline-scroll">
            <div className="m-timeline-inner">
              <TimelineV2
                line={line}
                simple
                selectedDate={selectedDate}
                selectedRange={{ from: selectedDate, to: selectedDate }}
                onSelectDate={setSelectedDate}
              />
            </div>
          </div>
        )}
        {screen === "roadmap" && <Roadmap selectedISO={selectedDate} />}
      </div>
    </div>
  );
}
