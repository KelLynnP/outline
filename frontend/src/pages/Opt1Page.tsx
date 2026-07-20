import { useCallback, useEffect, useState } from "react";
import type { CaughtItem, LineView, Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";
import { TimelineV2 } from "../components/TimelineV2.js";
import { DailyCalendar } from "../components/DailyCalendar.js";
import { TaskComposer } from "../components/Tasks.js";

export function Opt1Page() {
  const [line, setLine] = useState<LineView | null>(null);
  const [today, setToday] = useState<TodayView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<CaughtItem[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "urgent" | "overdue">("open");

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

  if (!line || !today || !settings) return <div className="quiet">loading…</div>;

  const openItems = items.filter((i) => i.status !== "closed");
  const filtered = openItems.filter((it) => {
    if (filter === "urgent") return it.tag === settings.tags.urgent || it.priority === 1;
    if (filter === "overdue") {
      if (!it.due_date) return false;
      return new Date(it.due_date) < new Date(today.date);
    }
    if (filter === "open") return it.status !== "closed";
    return true;
  });

  const stats = {
    tasks_open: openItems.length,
    urgent: openItems.filter((i) => i.tag === settings.tags.urgent || i.priority === 1).length,
    overdue: openItems.filter(
      (i) => i.due_date && new Date(i.due_date) < new Date(today.date),
    ).length,
    meals_24h: today.body.signals.filter(
      (s) => s.type === "meal" && Date.now() - new Date(s.timestamp).getTime() < 86400_000,
    ).length,
    rides_7d: today.body.signals.filter(
      (s) => s.type === "bike" && Date.now() - new Date(s.timestamp).getTime() < 7 * 86400_000,
    ).length,
    hours_since_meal:
      today.body.hours_since_meal !== null
        ? today.body.hours_since_meal.toFixed(1)
        : "—",
    last_sleep: today.body.last_sleep_hours ?? "—",
  };

  return (
    <div className="opt1">
      <div className="widget widget-timeline">
        <div className="widget-head">
          <span className="widget-title">timeline</span>
          <span className="widget-sub">{line.stops.length} recent · {line.dots.length} compressed · {line.future_stops.length} ahead</span>
        </div>
        <TimelineV2 line={line} />
      </div>

      <div className="widget widget-metrics">
        <div className="widget-head">
          <span className="widget-title">metrics</span>
          <span className="widget-sub">{today.date}</span>
        </div>
        <div className="metric-grid">
          <Metric label="OPEN" value={stats.tasks_open} />
          <Metric label="URGENT" value={stats.urgent} accent={stats.urgent > 0 ? "urgent" : undefined} />
          <Metric label="OVERDUE" value={stats.overdue} accent={stats.overdue > 0 ? "urgent" : undefined} />
          <Metric label="MEALS 24H" value={stats.meals_24h} />
          <Metric label="H SINCE MEAL" value={stats.hours_since_meal} accent={today.body.meal_alert ? "amber" : undefined} />
          <Metric label="RIDES 7D" value={stats.rides_7d} />
          <Metric label="LAST SLEEP" value={typeof stats.last_sleep === "number" ? `${stats.last_sleep}h` : stats.last_sleep} />
        </div>
      </div>

      <div className="widget widget-calendar">
        <div className="widget-head">
          <span className="widget-title">today · calendar</span>
        </div>
        <DailyCalendar date={today.date} variant="widget" />
      </div>

      <div className="widget widget-tasks">
        <div className="widget-head">
          <span className="widget-title">tasks</span>
          <span className="widget-filters">
            {(["open", "urgent", "overdue", "all"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </span>
        </div>
        <TaskComposer settings={settings} onCreated={load} compact />
        <table className="task-table">
          <thead>
            <tr>
              <th>PRIO</th>
              <th>DUE</th>
              <th>TASK</th>
              <th>TAGS</th>
              <th>STATE</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <TaskRow key={it.id} item={it} onChange={load} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="quiet">no tasks match filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="widget widget-body">
        <div className="widget-head">
          <span className="widget-title">body log</span>
        </div>
        <div className="body-quick">
          {settings.body.tracked.meals && (
            <button onClick={async () => { await api.logSignal({ type: "meal" }); load(); }}>
              log meal
            </button>
          )}
          {settings.body.tracked.bike && (
            <button onClick={async () => { await api.logSignal({ type: "bike" }); load(); }}>
              log ride
            </button>
          )}
          {settings.body.tracked.ocean && (
            <button onClick={async () => { await api.logSignal({ type: "ocean" }); load(); }}>
              log ocean
            </button>
          )}
        </div>
        <ul className="body-feed">
          {today.body.signals.slice(0, 8).map((s) => (
            <li key={s.id}>
              <span className="type">{s.type}</span>
              <span className="time">
                {new Date(s.timestamp).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="src">{s.source}</span>
            </li>
          ))}
          {today.body.signals.length === 0 && (
            <li className="quiet">no signals logged.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "urgent" | "amber";
}) {
  return (
    <div className={`metric ${accent ? `metric-${accent}` : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function TaskRow({ item, onChange }: { item: CaughtItem; onChange: () => void }) {
  const overdue =
    item.due_date && new Date(item.due_date) < new Date();
  return (
    <tr className={overdue ? "overdue" : ""}>
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
      <td className="mono">{item.status}</td>
      <td className="task-actions">
        <button onClick={async () => { await api.closeItem(item.id); onChange(); }}>close</button>
        {item.status !== "carried" && (
          <button onClick={async () => { await api.carryItem(item.id); onChange(); }}>carry</button>
        )}
      </td>
    </tr>
  );
}
