import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@life-console/shared";
import { api } from "../api.js";
import { dayDropProps } from "../dnd.js";

interface Props {
  weekStartISO: string; // Monday
  onSelectDay: (iso: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
  hourStart?: number;
  hourEnd?: number;
}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function parseTime(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}

export function WeekCalendar({
  weekStartISO,
  onSelectDay,
  onDropTask,
  hourStart = 7,
  hourEnd = 22,
}: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const days = useMemo(() => {
    const start = new Date(weekStartISO + "T00:00:00");
    return Array.from({ length: 7 }).map((_, i) =>
      iso(new Date(start.getTime() + i * DAY_MS)),
    );
  }, [weekStartISO]);

  useEffect(() => {
    fetch(`/api/events?from=${days[0]}&to=${days[6]}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [days[0], days[6]]);

  void api; // adapter file will populate events; api client not needed here

  const hourPx = 22;
  const totalHours = hourEnd - hourStart;
  const trackHeight = totalHours * hourPx;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="weekcal">
      <div className="weekcal-header">
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
            >
              <span className="wd">
                {dt.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span className="dn">{dt.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="weekcal-body" style={{ height: trackHeight }}>
        <div className="weekcal-hours">
          {Array.from({ length: totalHours + 1 }).map((_, i) => (
            <div key={i} className="weekcal-hour" style={{ top: i * hourPx }}>
              {String(hourStart + i).padStart(2, "0")}
            </div>
          ))}
        </div>

        {days.map((d) => (
          <div
            key={d}
            className="weekcal-col"
            data-date={d}
            {...(onDropTask ? dayDropProps(d, onDropTask) : {})}
          >
            {Array.from({ length: totalHours + 1 }).map((_, i) => (
              <div
                key={i}
                className="weekcal-cell"
                style={{ top: i * hourPx, height: hourPx }}
              />
            ))}
            {events
              .filter((e) => e.date === d)
              .map((e) => {
                const s = parseTime(e.start_time);
                const en = parseTime(e.end_time);
                const allDay = s === null;
                const top = allDay ? 0 : Math.max(0, (s - hourStart) * hourPx);
                const bottom =
                  en != null ? (en - hourStart) * hourPx : top + hourPx * 0.9;
                const synced = e.source !== "manual";
                return (
                  <div
                    key={e.id}
                    className={`weekcal-event ${allDay ? "allday" : ""} ${synced ? "synced" : ""}`}
                    style={
                      allDay
                        ? undefined
                        : { top, height: Math.max(14, bottom - top) }
                    }
                    title={e.title}
                    onDoubleClick={() => {
                      if (synced && e.deeplink) window.open(e.deeplink, "_blank");
                    }}
                  >
                    <span className="t">{e.title}</span>
                    {!allDay && e.start_time && (
                      <span className="tm">{e.start_time}</span>
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
