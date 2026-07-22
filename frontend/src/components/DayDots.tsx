import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@life-console/shared";
import { dayDropProps, taskDragProps } from "../dnd.js";
import { hueColors, tagColors } from "../colors.js";

interface Props {
  selectedISO: string;
  onSelect: (iso: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
  /** Change to force an event refetch. */
  refreshKey?: unknown;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Mini month as a small gantt: week rows of day circles, with colored bars
// underneath for day tasks / all-day themes (multi-day spans included).
// Drop a task on a day to make it that day's theme; drag a bar to move it.
export function DayDots({ selectedISO, onSelect, onDropTask, refreshKey }: Props) {
  const anchor = new Date(selectedISO + "T00:00:00");
  const y = anchor.getFullYear();
  const m = anchor.getMonth();

  const { weeks, first, last } = useMemo(() => {
    const count = new Date(y, m + 1, 0).getDate();
    const blanks = new Date(y, m, 1).getDay(); // Sunday-start
    const cells: (string | null)[] = [
      ...Array.from({ length: blanks }, () => null),
      ...Array.from({ length: count }, (_, i) => iso(new Date(y, m, i + 1))),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return {
      weeks,
      first: iso(new Date(y, m, 1)),
      last: iso(new Date(y, m, count)),
    };
  }, [y, m]);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    fetch(`/api/events?from=${first}&to=${last}`)
      .then((r) => r.json())
      .then((all: CalendarEvent[]) => setEvents(all.filter((e) => e.start_time == null)))
      .catch(() => setEvents([]));
  }, [first, last, refreshKey]);

  // Bars for one week row: clamp span to the week, pack into lanes.
  const barsForWeek = (week: (string | null)[]) => {
    const dates = week.filter((d): d is string => d !== null);
    if (dates.length === 0) return [];
    const wFirst = dates[0];
    const wLast = dates[dates.length - 1];
    const bars = events
      .map((e) => {
        const evEnd = e.end_date ?? e.date;
        if (e.date > wLast || evEnd < wFirst) return null;
        const c1 = week.indexOf(e.date > wFirst ? e.date : wFirst);
        const c2 = week.indexOf(evEnd < wLast ? evEnd : wLast);
        if (c1 === -1 || c2 === -1 || c2 < c1) return null;
        return { e, c1, c2, row: 0 };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.c1 - b.c1 || b.c2 - a.c2);
    const rowEnds: number[] = [];
    for (const b of bars) {
      let r = rowEnds.findIndex((end) => end < b.c1);
      if (r === -1) {
        r = rowEnds.length;
        rowEnds.push(b.c2);
      } else {
        rowEnds[r] = b.c2;
      }
      b.row = r;
    }
    return bars;
  };

  const today = new Date().toISOString().slice(0, 10);
  const label = anchor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="daydots">
      <div className="daydots-label">{label}</div>
      <div className="daydots-month">
        <div className="daydots-grid">
          {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
            <span key={`wd-${i}`} className="daydots-wd">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const bars = barsForWeek(week);
          return (
            <div key={wi} className="daydots-week">
              <div className="daydots-grid">
                {week.map((d, ci) => {
                  if (!d) return <span key={`b-${ci}`} />;
                  const dt = new Date(d + "T00:00:00");
                  return (
                    <button
                      key={d}
                      className={`daydot ${d === selectedISO ? "selected" : ""} ${d === today ? "today" : ""}`}
                      onClick={() => onSelect(d)}
                      title={dt.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      data-date={d}
                      {...(onDropTask ? dayDropProps(d, onDropTask) : {})}
                    >
                      <span className="dn">{dt.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              {bars.length > 0 && (
                <div className="daydots-lane">
                  {bars.map(({ e, c1, c2, row }) => {
                    const isTask = e.source === "task";
                    const tint =
                      isTask && e.item_tag
                        ? tagColors(e.item_tag)
                        : e.source === "manual" && e.hue != null
                          ? hueColors(e.hue)
                          : null;
                    const span = e.end_date
                      ? `${e.date} → ${e.end_date}`
                      : e.date;
                    return (
                      <button
                        key={e.id}
                        className="mini-bar"
                        style={{
                          gridColumn: `${c1 + 1} / ${c2 + 2}`,
                          gridRow: row + 1,
                          background: tint?.border ?? "#d9b83e",
                        }}
                        title={`${e.title} (${span}) — click to open`}
                        onClick={() => onSelect(e.date)}
                        {...(isTask && e.item_id ? taskDragProps(e.item_id) : {})}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
