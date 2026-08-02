import { useCallback, useEffect, useMemo, useState } from "react";
import {
  localDateISO,
  type CaughtItem,
  type LineView,
  type Settings,
  type TodayView,
} from "@life-console/shared";
import { api } from "../api.js";
import { TimelineV2 } from "../components/TimelineV2.js";
import { DailyCalendar } from "../components/DailyCalendar.js";
import { WeekCalendar } from "../components/WeekCalendar.js";
import { MonthCalendar } from "../components/MonthCalendar.js";
import { Roadmap } from "../components/Roadmap.js";
import { DayNotes } from "../components/DayNotes.js";
import { TaskTable } from "../components/Tasks.js";
import { useToggle } from "../useToggle.js";

type ViewMode = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const iso = localDateISO;

function mondayOf(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return iso(new Date(d.getTime() + diff * DAY_MS));
}

export function Opt3Page() {
  const [line, setLine] = useState<LineView | null>(null);
  const [today, setToday] = useState<TodayView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<CaughtItem[]>([]);
  const [view, setView] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    localDateISO(),
  );
  const [tasksOpen, toggleTasksSection] = useToggle("opt3.tasksOpen", true);
  // Bumped on every page-level reload so the calendars refetch their events
  // (they own their own fetches, e.g. after unschedule/complete from the board).
  const [calVersion, setCalVersion] = useState(0);

  const load = useCallback(async () => {
    const [l, t, s, i] = await Promise.all([
      api.line(),
      api.today(),
      api.settings(),
      api.allItems(),
    ]);
    setLine(l);
    setToday(t);
    setSettings(s);
    setItems(i);
    setCalVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  // Scheduling a task = set its due_date + create a light-yellow "task event"
  // on the calendar. Default 9:00 for 1 hour; time-slot drops pass the exact
  // hour, and moving an existing block passes its duration.
  const scheduleTaskAtTime = useCallback(
    async (itemId: number, date: string, startHM = "09:00", durationMin = 60) => {
      const item = await api.updateItem(itemId, { due_date: date });
      const [h, m] = startHM.split(":").map(Number);
      const endTotal = h * 60 + m + durationMin;
      const endHM = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
      await api.addEvent({
        date,
        start_time: startHM,
        end_time: endHM,
        title: item.text,
        source: "task",
        item_id: itemId,
        status: "pending",
      });
      await load();
    },
    [load],
  );
  const scheduleTaskOnDay = useCallback(
    (itemId: number, date: string) => scheduleTaskAtTime(itemId, date, "09:00"),
    [scheduleTaskAtTime],
  );
  // Assign a task to a whole day (no time) — a "day task" like "build day".
  const assignTaskToDay = useCallback(
    async (itemId: number, date: string) => {
      const item = await api.updateItem(itemId, { due_date: date });
      await api.addEvent({
        date,
        start_time: null,
        end_time: null,
        title: item.text,
        source: "task",
        item_id: itemId,
        status: "pending",
      });
      await load();
    },
    [load],
  );

  if (!line || !today || !settings) return <div className="quiet">loading…</div>;

  const shiftSelected = (days: number) => {
    const next = new Date(selectedDate + "T00:00:00");
    next.setDate(next.getDate() + days);
    setSelectedDate(iso(next));
  };
  const jumpToday = () => setSelectedDate(localDateISO());

  const anchor = new Date(selectedDate + "T00:00:00");
  // The range the page is currently showing; the timeline highlights it.
  const selectedRange =
    view === "week"
      ? (() => {
          const from = mondayOf(selectedDate);
          return { from, to: iso(new Date(new Date(from + "T00:00:00").getTime() + 6 * DAY_MS)) };
        })()
      : view === "month"
        ? {
            from: iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
            to: iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
          }
        : { from: selectedDate, to: selectedDate };
  const selectedLabel =
    view === "day"
      ? anchor.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
      : view === "week"
        ? (() => {
            const start = new Date(mondayOf(selectedDate) + "T00:00:00");
            const end = new Date(start.getTime() + 6 * DAY_MS);
            return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
          })()
        : anchor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="opt3">
      <div className="workboard">
        {/* ---------------- timeline row ---------------- */}
        <div className="workboard-timeline">
          <TimelineV2
            line={line}
            simple
            selectedDate={selectedDate}
            selectedRange={selectedRange}
            onSelectDate={setSelectedDate}
            onDropTask={scheduleTaskOnDay}
          />
        </div>

        {/* ---------- global date bar: the one source of truth for what
             dates the sections below (tasks, later health) display ---------- */}
        <div className="workboard-head">
          <div className="workboard-nav">
            <button
              onClick={() =>
                shiftSelected(view === "month" ? -30 : view === "week" ? -7 : -1)
              }
            >
              ‹
            </button>
            <button className="today-btn" onClick={jumpToday}>
              today
            </button>
            <button
              onClick={() =>
                shiftSelected(view === "month" ? 30 : view === "week" ? 7 : 1)
              }
            >
              ›
            </button>
          </div>
          <span className="workboard-date">{selectedLabel}</span>
          <div className="view-toggle">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* ---------------- section toggle ---------------- */}
        <button className="section-toggle" onClick={toggleTasksSection}>
          {tasksOpen ? "▾" : "▸"} tasks
        </button>

        {tasksOpen && (
        <>
        {/* ---------------- tasks + calendar ---------------- */}
        <div className="workboard-body">
          <div className="wb-tasks">
            <TaskTable
              items={items}
              settings={settings}
              onChange={load}
              scheduleToday={(id) => scheduleTaskAtTime(id, today.date)}
            />
          </div>

          <div className="wb-cal">
            <div className="wb-section-head">
              <span>
                {view === "day" ? "schedule" : view === "week" ? "week" : "month"}
              </span>
              <span className="date-chip">
                {today.date === selectedDate
                  ? "today"
                  : anchor.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
              </span>
            </div>

            {view === "day" && (
              <DailyCalendar
                date={selectedDate}
                variant="widget"
                onDropTaskAtTime={scheduleTaskAtTime}
                onTaskChange={load}
                refreshKey={calVersion}
              />
            )}
            {view === "week" && (
              <WeekCalendar
                weekStartISO={mondayOf(selectedDate)}
                onSelectDay={(d) => {
                  setSelectedDate(d);
                  setView("day");
                }}
                onDropTaskAtTime={scheduleTaskAtTime}
                onDropTaskOnDay={assignTaskToDay}
                refreshKey={calVersion}
              />
            )}
            {view === "month" && (
              <MonthCalendar
                monthISO={selectedDate}
                onSelectDay={(d) => {
                  setSelectedDate(d);
                  setView("day");
                }}
                onDropTask={scheduleTaskOnDay}
              />
            )}

            <Roadmap selectedISO={selectedDate} />
          </div>
        </div>

        {/* ---------------- notes for the day ---------------- */}
        <div className="workboard-notes">
          <DayNotes date={selectedDate} />
        </div>
        </>
        )}
      </div>
    </div>
  );
}