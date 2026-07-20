import { useMemo, useState } from "react";
import type { LineView, Stop } from "@life-console/shared";
import { api } from "../api.js";
import { dayDropProps } from "../dnd.js";

interface Props {
  line: LineView;
  compact?: boolean;
  simple?: boolean; // simple = past-only overview, hides future task pins
  selectedDate?: string;
  onSelectDate?: (iso: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
}

function parse(d: string) {
  return new Date(d + "T00:00:00");
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400_000);
}
function shortDate(d: string) {
  return parse(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function weekdayLetter(d: string) {
  return ["S", "M", "T", "W", "T", "F", "S"][parse(d).getDay()];
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

// A cleaner, more technical timeline: date grid, week ticks, weekday letters,
// explicit today label, hover surfaces summaries. No pastel bands — thin
// month divider lines with month labels instead.
export function TimelineV2({
  line,
  compact = false,
  simple = false,
  selectedDate,
  onSelectDate,
  onDropTask,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [detail, setDetail] = useState<Stop | null>(null);

  const height = compact ? 120 : 160;
  const trackY = compact ? 60 : 80;

  const { start, end, x, monthDividers, allDays } = useMemo(() => {
    const today = parse(line.today);
    const daysBack = 30;
    const daysForward = 21;
    const start = new Date(today.getTime() - daysBack * 86400_000);
    const end = new Date(today.getTime() + daysForward * 86400_000);
    const total = Math.max(1, daysBetween(start, end));
    const x = (d: string) => (daysBetween(start, parse(d)) / total) * 1000;
    const dividers: { x: number; label: string }[] = [];
    for (let i = 0; i <= total; i++) {
      const d = new Date(start.getTime() + i * 86400_000);
      if (d.getDate() === 1) {
        dividers.push({
          x: (i / total) * 1000,
          label: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
        });
      }
    }
    const allDays: string[] = [];
    for (let i = 0; i <= total; i++) {
      allDays.push(iso(new Date(start.getTime() + i * 86400_000)));
    }
    return { start, end, x, monthDividers: dividers, allDays };
  }, [line, compact]);

  void start;
  void end;
  const todayX = x(line.today);
  const stopMap = new Map(line.stops.map((s) => [s.date, s]));
  const dotSet = new Set(line.dots);

  return (
    <div className="tlv2">
      <svg viewBox={`-8 0 1016 ${height}`} preserveAspectRatio="none" style={{ height }}>
        {monthDividers.map((m) => (
          <g key={`${m.x}-${m.label}`}>
            <line
              x1={m.x}
              x2={m.x}
              y1={trackY - 32}
              y2={trackY + 24}
              stroke="var(--tl-divider)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={m.x + 6}
              y={trackY - 22}
              fontSize={9}
              fontWeight={700}
              letterSpacing={1.5}
              fill="var(--tl-muted)"
              fontFamily="var(--display)"
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* week ticks + weekday letters at Mondays */}
        {allDays.map((d) => {
          const wd = parse(d).getDay();
          if (wd !== 1) return null;
          return (
            <text
              key={`wk-${d}`}
              x={x(d)}
              y={trackY + 32}
              textAnchor="middle"
              fontSize={8}
              fill="var(--tl-muted)"
              fontFamily="var(--display)"
              letterSpacing={0.5}
            >
              {parse(d).getDate()}
            </text>
          );
        })}

        {/* solid past track, dashed future */}
        <line
          x1={-4}
          x2={todayX}
          y1={trackY}
          y2={trackY}
          stroke="var(--tl-track)"
          strokeWidth={compact ? 3 : 4}
          strokeLinecap="round"
        />
        <line
          x1={todayX}
          x2={1004}
          y1={trackY}
          y2={trackY}
          stroke="var(--tl-track)"
          strokeWidth={compact ? 3 : 4}
          strokeLinecap="round"
          strokeDasharray="3 6"
          opacity={0.55}
        />

        {/* every-day micro ticks */}
        {allDays.map((d) => (
          <line
            key={`t-${d}`}
            x1={x(d)}
            x2={x(d)}
            y1={trackY - 3}
            y2={trackY + 3}
            stroke="var(--tl-track)"
            strokeWidth={1}
            opacity={0.35}
          />
        ))}

        {/* dot days (compressed old) */}
        {allDays.map((d) => {
          if (!dotSet.has(d)) return null;
          return (
            <circle
              key={`d-${d}`}
              cx={x(d)}
              cy={trackY}
              r={2.5}
              fill="var(--tl-track)"
            />
          );
        })}

        {/* recent stops (clickable) */}
        {line.stops.map((s) => {
          const isHover = hovered === s.date;
          return (
            <g
              key={s.date}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(s.date)}
              onMouseLeave={() => setHovered((h) => (h === s.date ? null : h))}
              onClick={async () => {
                try {
                  setDetail(await api.stop(s.date));
                } catch {
                  setDetail(null);
                }
              }}
            >
              <circle
                cx={x(s.date)}
                cy={trackY}
                r={isHover ? 6 : 4.5}
                fill="var(--tl-station)"
                stroke="var(--tl-track)"
                strokeWidth={2}
              />
              <text
                x={x(s.date)}
                y={trackY - 12}
                textAnchor="middle"
                fontSize={8}
                fill="var(--tl-muted)"
                fontFamily="var(--display)"
              >
                {weekdayLetter(s.date)}
              </text>
            </g>
          );
        })}

        {/* future stops */}
        {!simple && line.future_stops.map((f) => {
          const isUrgent = f.tag.includes("!");
          return (
            <g key={`${f.date}-${f.text}`}>
              <circle
                cx={x(f.date)}
                cy={trackY}
                r={5}
                fill="var(--tl-station)"
                stroke={isUrgent ? "var(--accent-urgent)" : "var(--tl-track)"}
                strokeWidth={2}
              />
              <text
                x={x(f.date)}
                y={trackY - 12}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={isUrgent ? "var(--accent-urgent)" : "var(--tl-ink)"}
                fontFamily="var(--display)"
              >
                {f.text.length > 20 ? f.text.slice(0, 18) + "…" : f.text}
              </text>
              <text
                x={x(f.date)}
                y={trackY + 22}
                textAnchor="middle"
                fontSize={8}
                fill="var(--tl-muted)"
                fontFamily="var(--display)"
                letterSpacing={0.5}
              >
                {shortDate(f.date).toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* today marker */}
        <g transform={`translate(${todayX}, ${trackY})`}>
          <line
            x1={0}
            x2={0}
            y1={-30}
            y2={22}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            opacity={0.7}
          />
          <circle r={6} fill="var(--accent)" />
          <text
            y={-34}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            letterSpacing={2}
            fill="var(--accent)"
            fontFamily="var(--display)"
          >
            TODAY
          </text>
        </g>
      </svg>

      {detail && (
        <div className="tlv2-popover" onClick={() => setDetail(null)}>
          <div className="tlv2-popover-inner">
            <div className="date">{shortDate(detail.date)}</div>
            <div className="summary">
              {detail.summary ?? <span className="muted">no summary.</span>}
            </div>
            {detail.journal_deeplink && (
              <a href={detail.journal_deeplink}>open in heptabase →</a>
            )}
          </div>
        </div>
      )}

      {hovered && stopMap.get(hovered)?.summary && !detail && (
        <div className="tlv2-hover-caption">
          <b>{shortDate(hovered)}</b> · {stopMap.get(hovered)?.summary}
        </div>
      )}
    </div>
  );
}
