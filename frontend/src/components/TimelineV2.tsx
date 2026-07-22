import { useMemo, useState } from "react";
import type { LineView } from "@life-console/shared";
import { dayDropProps } from "../dnd.js";

interface Props {
  line: LineView;
  compact?: boolean;
  simple?: boolean; // simple = past-only overview, hides future task pins
  selectedDate?: string;
  /** Highlight band for the range the page is showing (day / week / month). */
  selectedRange?: { from: string; to: string };
  onSelectDate?: (iso: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
}

const DAY_MS = 86_400_000;

function parse(d: string) {
  return new Date(d + "T00:00:00");
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
function shortDate(d: string) {
  return parse(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Timeline is now a spine you can click and drop tasks onto.
// - SVG draws month dividers, track, today marker, stops, dots, future pins.
// - HTML overlay above the SVG has one thin "day slot" per day, so click
//   and native drag/drop work reliably on the whole day column.
export function TimelineV2({
  line,
  compact = false,
  simple = false,
  selectedDate,
  selectedRange,
  onSelectDate,
  onDropTask,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const height = compact ? 130 : 170;
  const trackY = compact ? 66 : 86;

  const { start, x, monthDividers, allDays, total } = useMemo(() => {
    const today = parse(line.today);
    const daysBack = 30;
    const daysForward = 21;
    const start = new Date(today.getTime() - daysBack * DAY_MS);
    const end = new Date(today.getTime() + daysForward * DAY_MS);
    const total = Math.max(1, daysBetween(start, end));
    const x = (d: string) => (daysBetween(start, parse(d)) / total) * 1000;
    const dividers: { x: number; label: string }[] = [];
    const allDays: string[] = [];
    for (let i = 0; i <= total; i++) {
      const d = new Date(start.getTime() + i * DAY_MS);
      allDays.push(iso(d));
      if (d.getDate() === 1) {
        dividers.push({
          x: (i / total) * 1000,
          label: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
        });
      }
    }
    return { start, x, monthDividers: dividers, allDays, total };
  }, [line]);

  void start;
  const todayX = x(line.today);
  const dotSet = new Set(line.dots);
  const stopSet = new Set(line.stops.map((s) => s.date));

  // Selected-range band, clamped to the visible window.
  const dayW = 1000 / total;
  const band = selectedRange
    ? (() => {
        const x1 = Math.max(0, Math.min(1000, x(selectedRange.from) - dayW / 2));
        const x2 = Math.max(0, Math.min(1000, x(selectedRange.to) + dayW / 2));
        return x2 > x1 ? { x: x1, w: x2 - x1 } : null;
      })()
    : null;

  return (
    <div className="tlv2">
      <div className="tlv2-canvas" style={{ height }}>
        <svg
          viewBox={`-8 0 1016 ${height}`}
          preserveAspectRatio="none"
          style={{ height, width: "100%" }}
        >
          {band && (
            <rect
              x={band.x}
              y={trackY - 34}
              width={band.w}
              height={62}
              rx={4}
              fill="var(--accent)"
              opacity={0.09}
            />
          )}

          {monthDividers.map((m) => (
            <g key={`${m.x}-${m.label}`}>
              <line
                x1={m.x}
                x2={m.x}
                y1={trackY - 34}
                y2={trackY + 28}
                stroke="var(--tl-divider)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={m.x + 6}
                y={trackY - 24}
                fontSize={12}
                fontWeight={700}
                letterSpacing={1.5}
                fill="var(--tl-ink)"
                fontFamily="var(--display)"
              >
                {m.label}
              </text>
            </g>
          ))}

          {allDays.map((d) => {
            const wd = parse(d).getDay();
            if (wd !== 1) return null;
            return (
              <text
                key={`wk-${d}`}
                x={x(d)}
                y={trackY + 38}
                textAnchor="middle"
                fontSize={11}
                fill="var(--tl-muted)"
                fontFamily="var(--display)"
                letterSpacing={0.5}
              >
                {parse(d).getDate()}
              </text>
            );
          })}

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

          {line.stops.map((s) => {
            const isSelected = selectedDate === s.date;
            const isHover = hovered === s.date;
            return (
              <g key={s.date} pointerEvents="none">
                <circle
                  cx={x(s.date)}
                  cy={trackY}
                  r={isSelected || isHover ? 6 : 4.5}
                  fill={isSelected ? "var(--accent)" : "var(--tl-station)"}
                  stroke={isSelected ? "var(--accent)" : "var(--tl-track)"}
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {!simple &&
            line.future_stops.map((f) => {
              const isUrgent = f.tag.includes("!");
              return (
                <g key={`${f.date}-${f.text}`} pointerEvents="none">
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
                    y={trackY - 14}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={isUrgent ? "var(--accent-urgent)" : "var(--tl-ink)"}
                    fontFamily="var(--display)"
                  >
                    {f.text.length > 20 ? f.text.slice(0, 18) + "…" : f.text}
                  </text>
                </g>
              );
            })}

          <g transform={`translate(${todayX}, ${trackY})`} pointerEvents="none">
            <line
              x1={0}
              x2={0}
              y1={-32}
              y2={26}
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeDasharray="2 2"
              opacity={0.6}
            />
            <circle
              r={6}
              fill={selectedDate === line.today ? "var(--accent)" : "var(--card)"}
              stroke="var(--accent)"
              strokeWidth={2.5}
            />
            <text
              y={-36}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              letterSpacing={2}
              fill="var(--accent)"
              fontFamily="var(--display)"
            >
              TODAY
            </text>
          </g>
        </svg>

        {/* invisible per-day hit slots for click + drop */}
        <div className="tlv2-slots" aria-hidden={onSelectDate ? "false" : "true"}>
          {allDays.map((d) => {
            const leftPct = (daysBetween(start, parse(d)) / total) * 100;
            const widthPct = 100 / (total + 1);
            const isSpecial = stopSet.has(d) || dotSet.has(d) || d === line.today;
            return (
              <div
                key={`slot-${d}`}
                className="tlv2-slot"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                data-date={d}
                onMouseEnter={() => setHovered(d)}
                onMouseLeave={() => setHovered((h) => (h === d ? null : h))}
                onClick={() => onSelectDate?.(d)}
                {...(onDropTask ? dayDropProps(d, onDropTask, "drop-over-day") : {})}
                title={
                  isSpecial
                    ? `${shortDate(d)} — click to focus`
                    : shortDate(d)
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
