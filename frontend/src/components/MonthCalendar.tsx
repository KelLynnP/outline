import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@life-console/shared";

interface Props {
  monthISO: string; // any date in the month
  onSelectDay: (iso: string) => void;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function MonthCalendar({ monthISO, onSelectDay }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const anchor = new Date(monthISO + "T00:00:00");
  const y = anchor.getFullYear();
  const m = anchor.getMonth();

  const { cells, monthStart, monthEnd } = useMemo(() => {
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);
    // 6 rows x 7 cols starting from Sunday of week 1
    const firstWeekday = monthStart.getDay();
    const gridStart = new Date(y, m, 1 - firstWeekday);
    const cells: string[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(iso(d));
    }
    return { cells, monthStart, monthEnd };
  }, [y, m]);

  useEffect(() => {
    fetch(`/api/events?from=${cells[0]}&to=${cells[cells.length - 1]}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [cells[0], cells[cells.length - 1]]);

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = eventsByDate.get(e.date) ?? [];
    arr.push(e);
    eventsByDate.set(e.date, arr);
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekdayHeaders = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="monthcal">
      <div className="monthcal-title">
        {anchor.toLocaleString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div className="monthcal-grid">
        {weekdayHeaders.map((w, i) => (
          <div key={i} className="monthcal-wd">
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const dt = new Date(d + "T00:00:00");
          const inMonth = dt >= monthStart && dt <= monthEnd;
          const isToday = d === today;
          const dayEvents = eventsByDate.get(d) ?? [];
          return (
            <div
              key={d}
              className={`monthcal-cell ${inMonth ? "" : "muted"} ${isToday ? "today" : ""}`}
              data-date={d}
              onClick={() => onSelectDay(d)}
            >
              <div className="dn">{dt.getDate()}</div>
              <div className="ev">
                {dayEvents.slice(0, 3).map((e) => (
                  <div key={e.id} className="pill" title={e.title}>
                    {e.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="more">+{dayEvents.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
