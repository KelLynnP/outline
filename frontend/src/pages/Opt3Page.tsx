import { useCallback, useEffect, useMemo, useState } from "react";
import type { CaughtItem, LineView, Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";
import { TimelineV2 } from "../components/TimelineV2.js";
import { DailyCalendar } from "../components/DailyCalendar.js";
import { WeekCalendar } from "../components/WeekCalendar.js";
import { MonthCalendar } from "../components/MonthCalendar.js";
import { DayDots } from "../components/DayDots.js";
import { DayNotes } from "../components/DayNotes.js";
import { TaskComposer } from "../components/Tasks.js";
import { taskDragProps } from "../dnd.js";

type ViewMode = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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
  const [filter, setFilter] = useState<"open" | "urgent" | "overdue" | "all">("open");
  const [view, setView] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );

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
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const scheduleTaskOnDay = useCallback(
    async (itemId: number, date: string) => {
      await api.updateItem(itemId, { due_date: date });
      load();
    },
    [load],
  );

  const filtered = useMemo(() => {
    if (!today) return [] as CaughtItem[];
    const open = items.filter((i) => i.status !== "closed");
    if (filter === "urgent")
      return open.filter((i) => i.tag === "#c!" || i.priority === 1);
    if (filter === "overdue")
      return open.filter(
        (i) => i.due_date && new Date(i.due_date) < new Date(today.date),
      );
    if (filter === "all") return items;
    return open;
  }, [items, filter, today]);

  if (!line || !today || !settings) return <div className="quiet">loading…</div>;

  const shiftSelected = (days: number) => {
    const next = new Date(selectedDate + "T00:00:00");
    next.setDate(next.getDate() + days);
    setSelectedDate(iso(next));
  };
  const jumpToday = () => setSelectedDate(new Date().toISOString().slice(0, 10));

  const anchor = new Date(selectedDate + "T00:00:00");
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
            onSelectDate={setSelectedDate}
            onDropTask={scheduleTaskOnDay}
          />
        </div>

        {/* ---------------- header ---------------- */}
        <div className="workboard-head">
          <div className="workboard-title">workboard</div>
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
            <span className="workboard-date">{selectedLabel}</span>
          </div>
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

        {/* ---------------- tasks + calendar ---------------- */}
        <div className="workboard-body">
          <div className="wb-tasks">
            <div className="wb-section-head">
              <span>tasks</span>
              <div className="widget-filters">
                {(["open", "urgent", "overdue", "all"] as const).map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "active" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <TaskComposer settings={settings} onCreated={load} compact />
            <div className="drag-hint">drag a row onto any day to schedule it.</div>
            <table className="task-table">
              <thead>
                <tr>
                  <th></th>
                  <th>PRIO</th>
                  <th>DUE</th>
                  <th>TASK</th>
                  <th>TAGS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <TaskRow key={it.id} item={it} onChange={load} />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="quiet">
                      nothing matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="wb-cal">
            <div className="wb-section-head">
              <span>
                {view === "day" ? "schedule" : view === "week" ? "week" : "month"}
              </span>
              <span className="quiet">
                {view === "day" && today.date === selectedDate ? "today" : ""}
              </span>
            </div>

            {view === "day" && (
              <DailyCalendar
                date={selectedDate}
                variant="widget"
                onDropTask={scheduleTaskOnDay}
              />
            )}
            {view === "week" && (
              <WeekCalendar
                weekStartISO={mondayOf(selectedDate)}
                onSelectDay={(d) => {
                  setSelectedDate(d);
                  setView("day");
                }}
                onDropTask={scheduleTaskOnDay}
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

            <DayDots
              selectedISO={selectedDate}
              onSelect={setSelectedDate}
              onDropTask={scheduleTaskOnDay}
            />
          </div>
        </div>

        {/* ---------------- notes for the day ---------------- */}
        <div className="workboard-notes">
          <DayNotes date={selectedDate} />
        </div>
      </div>
    </div>
  );
}

function TaskRow({
  item,
  onChange,
}: {
  item: CaughtItem;
  onChange: () => void;
}) {
  const overdue = item.due_date && new Date(item.due_date) < new Date();
  return (
    <tr
      className={overdue ? "overdue" : ""}
      data-item-id={item.id}
      {...taskDragProps(item.id)}
    >
      <td className="drag-handle" title="drag onto a day to schedule">⋮⋮</td>
      <td>
        <span className={`prio-chip prio-${item.priority}`}>P{item.priority}</span>
      </td>
      <td className="mono">
        {item.due_date
          ? new Date(item.due_date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "—"}
      </td>
      <td className="task-text">
        {item.tag === "#c!" && <span className="tag-c urgent">!</span>}
        {item.tag === "#c?" && <span className="tag-c question">?</span>}
        {item.text}
      </td>
      <td>
        {item.tags.length === 0 ? (
          <span className="quiet mono">—</span>
        ) : (
          item.tags.map((t) => (
            <span key={t} className="tag-chip">
              #{t}
            </span>
          ))
        )}
      </td>
      <td className="task-actions">
        <button
          onClick={async () => {
            await api.closeItem(item.id);
            onChange();
          }}
        >
          close
        </button>
        {item.status !== "carried" && (
          <button
            onClick={async () => {
              await api.carryItem(item.id);
              onChange();
            }}
          >
            carry
          </button>
        )}
      </td>
    </tr>
  );
}
