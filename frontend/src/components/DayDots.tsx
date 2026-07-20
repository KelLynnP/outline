import { useMemo } from "react";

interface Props {
  selectedISO: string;
  onSelect: (iso: string) => void;
  // range: how many days around today to show. defaults to the current month.
  range?: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

// horizontal row of small dots, one per day, for jumping between days.
// selected = filled with accent color, today = ring, others = quiet dot.
export function DayDots({ selectedISO, onSelect, range }: Props) {
  const days = useMemo(() => {
    if (range) {
      const start = new Date(Date.now() - Math.floor(range / 2) * DAY_MS);
      return Array.from({ length: range }).map((_, i) =>
        iso(new Date(start.getTime() + i * DAY_MS)),
      );
    }
    const anchor = new Date(selectedISO + "T00:00:00");
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const end = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: end }).map((_, i) => iso(new Date(y, m, i + 1)));
  }, [selectedISO, range]);

  const today = new Date().toISOString().slice(0, 10);
  const anchor = new Date(selectedISO + "T00:00:00");
  const label = anchor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="daydots">
      <div className="daydots-label">{label}</div>
      <div className="daydots-row">
        {days.map((d) => {
          const dt = new Date(d + "T00:00:00");
          const isSelected = d === selectedISO;
          const isToday = d === today;
          const isMonday = dt.getDay() === 1;
          return (
            <button
              key={d}
              className={`daydot ${isSelected ? "selected" : ""} ${isToday ? "today" : ""} ${isMonday ? "week-start" : ""}`}
              onClick={() => onSelect(d)}
              title={dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              data-date={d}
            >
              <span className="dn">{dt.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
