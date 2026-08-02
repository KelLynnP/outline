import { useEffect, useMemo, useRef, useState } from "react";
import { localDateISO, type CalendarEvent } from "@life-console/shared";
import { api } from "../api.js";
import {
  EVENT_MIME,
  TASK_MIME,
  dayDropProps,
  dragDurationMin,
  eventDragProps,
  taskDragProps,
} from "../dnd.js";
import { fmt12, h12 } from "../time.js";
import { hueColors, tagColors } from "../colors.js";
import { useToggle } from "../useToggle.js";

interface Props {
  weekStartISO: string; // Monday
  onSelectDay: (iso: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
  /** When provided, drops land at the hour you release on (not 09:00). */
  onDropTaskAtTime?: (
    itemId: number,
    date: string,
    startHM: string,
    durationMin?: number,
  ) => void | Promise<void>;
  /** Drop a task on a day header → all-day "day task" (e.g. "build day"). */
  onDropTaskOnDay?: (itemId: number, date: string) => void | Promise<void>;
  hourStart?: number;
  hourEnd?: number;
  /** Change to force an event refetch. */
  refreshKey?: unknown;
}

function parseTime(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}
const pad = (n: number) => String(n).padStart(2, "0");
function toHM(hour: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  return `${pad(h)}:${hour - h >= 0.5 ? "30" : "00"}`;
}

export function WeekCalendar({
  weekStartISO,
  onSelectDay,
  onDropTask,
  onDropTaskAtTime,
  onDropTaskOnDay,
  hourStart = 7,
  hourEnd = 22,
  refreshKey,
}: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weekend, toggleWeekend] = useToggle("weekcal.weekend", true);
  // Horizontal stretch of an all-day bar across days (sets end_date on release).
  const [stretch, setStretch] = useState<{ id: number; endIdx: number } | null>(null);
  const stretchRef = useRef<typeof stretch>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const start = new Date(weekStartISO + "T00:00:00");
    const all = Array.from({ length: 7 }).map((_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return localDateISO(day);
    });
    return weekend ? all : all.slice(0, 5); // Monday-start week: drop Sat+Sun
  }, [weekStartISO, weekend]);

  const loadEvents = () =>
    fetch(`/api/events?from=${days[0]}&to=${days[days.length - 1]}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  useEffect(() => {
    loadEvents();
  }, [days[0], days[days.length - 1], refreshKey]);

  const hourPx = 22;
  const totalHours = hourEnd - hourStart;
  const trackHeight = totalHours * hourPx;
  const today = localDateISO();

  const cols = { gridTemplateColumns: `34px repeat(${days.length}, 1fr)` };

  // Day tasks / all-day events, as bars spanning their days (clamped to view).
  // Non-overlapping bars share a line so the lane stays as short as possible.
  const dayIdx = (d: string) => days.indexOf(d);
  const allDayBars = useMemo(() => {
    const bars = events
      .filter((e) => e.start_time == null)
      .map((e) => {
        const endDate = e.end_date ?? e.date;
        if (endDate < days[0] || e.date > days[days.length - 1]) return null;
        const startIdx = Math.max(0, e.date < days[0] ? 0 : dayIdx(e.date));
        const rawEnd = dayIdx(endDate);
        const endIdx = rawEnd === -1 ? days.length - 1 : rawEnd;
        if (endIdx < startIdx) return null;
        return { e, startIdx, endIdx, multi: endDate !== e.date, row: 0 };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);
    const rowEnds: number[] = []; // last occupied day index per line
    for (const b of bars) {
      let r = rowEnds.findIndex((end) => end < b.startIdx);
      if (r === -1) {
        r = rowEnds.length;
        rowEnds.push(b.endIdx);
      } else {
        rowEnds[r] = b.endIdx;
      }
      b.row = r;
    }
    return bars;
  }, [events, days]);

  // Stretch: track the pointer across day columns, commit end_date on release.
  useEffect(() => {
    if (!stretch) return;
    const idxFromX = (clientX: number) => {
      const el = laneRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const colW = (rect.width - 34) / days.length;
      return Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left - 34) / colW)));
    };
    const onMove = (ev: MouseEvent) => {
      setStretch((s) => {
        if (!s) return s;
        const next = { ...s, endIdx: idxFromX(ev.clientX) };
        stretchRef.current = next;
        return next;
      });
    };
    const onUp = async () => {
      const s = stretchRef.current;
      stretchRef.current = null;
      setStretch(null);
      if (!s) return;
      const bar = allDayBars.find((b) => b.e.id === s.id);
      if (!bar) return;
      const end = s.endIdx > bar.startIdx ? days[s.endIdx] : null;
      await api.setEventEndDate(s.id, end);
      loadEvents();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [stretch !== null]);

  return (
    <div className="weekcal">
      <div className="weekcal-toolbar">
        <button
          className={`tog ${weekend ? "on" : ""}`}
          onClick={toggleWeekend}
          title="show saturday + sunday"
        >
          weekend
        </button>
      </div>
      <div className="weekcal-header" style={cols}>
        <div className="weekcal-corner" />
        {days.map((d) => {
          const dt = new Date(d + "T00:00:00");
          const isToday = d === today;
          return (
            <div
              key={d}
              className={`weekcal-day-header ${isToday ? "today" : ""}`}
              onClick={() => onSelectDay(d)}
              data-date={d}
              title="drop a task here to assign it to this day"
              {...(onDropTaskOnDay
                ? {
                    onDragOver: (e: React.DragEvent) => {
                      if (!e.dataTransfer.types.includes(TASK_MIME)) return;
                      e.preventDefault();
                      e.currentTarget.classList.add("drop-over");
                    },
                    onDragLeave: (e: React.DragEvent) => {
                      e.currentTarget.classList.remove("drop-over");
                    },
                    onDrop: async (e: React.DragEvent) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("drop-over");
                      const id = Number(e.dataTransfer.getData(TASK_MIME));
                      if (!id) return;
                      await onDropTaskOnDay(id, d);
                      loadEvents();
                    },
                  }
                : {})}
            >
              <span className="wd">
                {dt.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span className="dn">{dt.getDate()}</span>
            </div>
          );
        })}
      </div>

      {allDayBars.length > 0 && (
        <div className="weekcal-allday" style={cols} ref={laneRef}>
          {allDayBars.map(({ e, startIdx, endIdx, multi, row }) => {
            const liveEnd =
              stretch?.id === e.id ? Math.max(startIdx, stretch.endIdx) : endIdx;
            const isTask = e.source === "task";
            const tint =
              isTask && e.item_tag
                ? tagColors(e.item_tag)
                : e.source === "manual" && e.hue != null
                  ? hueColors(e.hue)
                  : null;
            const stretchable = isTask || e.source === "manual";
            return (
              <div
                key={e.id}
                className={`wk-bar ${multi || liveEnd > startIdx ? "multi" : ""} ${isTask ? "task-event" : "synced"}`}
                style={{
                  gridColumn: `${startIdx + 2} / ${liveEnd + 3}`,
                  gridRow: row + 1,
                  ...(tint
                    ? { background: tint.bg, borderColor: tint.border, color: tint.ink }
                    : {}),
                }}
                title={`${e.title} — click to open the day`}
                onClick={() => onSelectDay(e.date)}
                {...(isTask && e.item_id ? taskDragProps(e.item_id) : {})}
              >
                <span className="t">{e.title}</span>
                {stretchable && (
                  <span
                    className="wk-bar-stretch"
                    title="drag to span more days"
                    draggable={false}
                    onDragStart={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const s = { id: e.id, endIdx: liveEnd };
                      stretchRef.current = s;
                      setStretch(s);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="weekcal-body" style={{ height: trackHeight, ...cols }}>
        <div className="weekcal-hours">
          {Array.from({ length: totalHours + 1 }).map((_, i) => (
            <div key={i} className="weekcal-hour" style={{ top: i * hourPx }}>
              {h12(hourStart + i)}
            </div>
          ))}
        </div>

        {days.map((d) => (
          <div
            key={d}
            className="weekcal-col"
            data-date={d}
            {...(onDropTaskAtTime
              ? {
                  onDragOver: (e: React.DragEvent) => {
                    const t = e.dataTransfer.types;
                    if (!t.includes(TASK_MIME) && !t.includes(EVENT_MIME)) return;
                    e.preventDefault();
                    e.currentTarget.classList.add("drop-over");
                  },
                  onDragLeave: (e: React.DragEvent) => {
                    e.currentTarget.classList.remove("drop-over");
                  },
                  onDrop: async (e: React.DragEvent) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("drop-over");
                    const rect = e.currentTarget.getBoundingClientRect();
                    const raw = hourStart + (e.clientY - rect.top) / hourPx;
                    const hour = Math.max(
                      hourStart,
                      Math.min(hourEnd - 1, Math.round(raw * 2) / 2),
                    );
                    const durMin = dragDurationMin(e.dataTransfer) ?? 60;
                    const taskId = Number(e.dataTransfer.getData(TASK_MIME));
                    const eventId = Number(e.dataTransfer.getData(EVENT_MIME));
                    if (taskId) {
                      await onDropTaskAtTime(taskId, d, toHM(hour), durMin);
                      loadEvents();
                    } else if (eventId) {
                      const start = toHM(hour);
                      const total =
                        Number(start.slice(0, 2)) * 60 +
                        Number(start.slice(3)) +
                        durMin;
                      const end = `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
                      await api.setEventTimes(eventId, start, end, d);
                      loadEvents();
                    }
                  },
                }
              : onDropTask
                ? dayDropProps(d, onDropTask)
                : {})}
          >
            {Array.from({ length: totalHours + 1 }).map((_, i) => (
              <div
                key={i}
                className="weekcal-cell"
                style={{ top: i * hourPx, height: hourPx }}
              />
            ))}
            {events
              .filter((e) => e.date === d && e.start_time != null)
              .map((e) => {
                const s = parseTime(e.start_time);
                const en = parseTime(e.end_time);
                const allDay = s === null;
                const top = allDay ? 0 : Math.max(0, (s! - hourStart) * hourPx);
                const bottom =
                  en != null ? (en - hourStart) * hourPx : top + hourPx * 0.9;
                const synced = e.source !== "manual";
                const durMin =
                  s != null ? Math.round(((en ?? s + 1) - s) * 60) : 60;
                const tint =
                  e.source === "task" && e.item_tag
                    ? tagColors(e.item_tag)
                    : e.source === "manual" && e.hue != null
                      ? hueColors(e.hue)
                      : null;
                return (
                  <div
                    key={e.id}
                    className={`weekcal-event ${allDay ? "allday" : ""} ${synced ? "synced" : ""} ${e.source === "task" ? "task-event" : ""} ${e.status === "confirmed" ? "confirmed" : ""}`}
                    style={{
                      ...(allDay
                        ? {}
                        : { top, height: Math.max(14, bottom - top) }),
                      ...(tint
                        ? {
                            background: tint.bg,
                            borderColor: tint.border,
                            color: tint.ink,
                          }
                        : {}),
                    }}
                    {...(allDay
                      ? {}
                      : e.source === "task" && e.item_id
                        ? taskDragProps(e.item_id, durMin)
                        : e.source === "manual"
                          ? eventDragProps(e.id, durMin)
                          : {})}
                    title={`${e.title} — click to open the day`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectDay(e.date);
                    }}
                    onDoubleClick={() => {
                      if (synced && e.deeplink) window.open(e.deeplink, "_blank");
                    }}
                  >
                    <span className="t">{e.title}</span>
                    {!allDay && e.start_time && (
                      <span className="tm">{fmt12(e.start_time)}</span>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
