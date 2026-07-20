import { useMemo, useState } from "react";
import type { LineView, Stop } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  line: LineView;
}

const HEIGHT = 200;
const LINE_Y = 110;

function parse(d: string) {
  return new Date(d + "T00:00:00");
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400_000);
}
function shortDate(d: string) {
  const dt = parse(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TrainLine({ line }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ date: string; stop: Stop | null } | null>(null);

  const { start, end, x, monthBands } = useMemo(() => {
    const today = parse(line.today);
    const monthsBack = line.months.length;
    const start = new Date(today.getFullYear(), today.getMonth() - (monthsBack - 1), 1);
    const futureDates = line.future_stops.map((f) => parse(f.date).getTime());
    const maxFuture = futureDates.length
      ? new Date(Math.max(...futureDates))
      : new Date(today.getTime() + 30 * 86400_000);
    const end = new Date(
      Math.max(maxFuture.getTime(), today.getTime() + 21 * 86400_000),
    );
    const totalDays = Math.max(1, daysBetween(start, end));
    const x = (d: string) => {
      const days = daysBetween(start, parse(d));
      return (days / totalDays) * 1000;
    };
    const monthBands = line.months.map((m, i) => {
      const [y, mm] = m.key.split("-").map(Number);
      const bandStart = new Date(y, mm - 1, 1);
      const bandEnd = new Date(y, mm, 1);
      const clampedEnd = bandEnd > end ? end : bandEnd;
      const clampedStart = bandStart < start ? start : bandStart;
      return {
        key: m.key,
        label: m.label,
        hue: m.hue,
        x1: (daysBetween(start, clampedStart) / totalDays) * 1000,
        x2: (daysBetween(start, clampedEnd) / totalDays) * 1000,
        i,
      };
    });
    return { start, end, x, monthBands };
  }, [line]);

  void start;
  void end;

  const todayX = x(line.today);

  const openStop = async (date: string) => {
    try {
      const stop = await api.stop(date);
      setDetail({ date, stop });
    } catch {
      setDetail({ date, stop: null });
    }
  };

  return (
    <div className="train">
      <svg viewBox={`-20 0 1040 ${HEIGHT}`} preserveAspectRatio="none" style={{ height: HEIGHT }}>
        {monthBands.map((b) => (
          <g key={b.key}>
            <rect
              x={b.x1 + 2}
              y={LINE_Y - 56}
              width={Math.max(0, b.x2 - b.x1 - 4)}
              height={112}
              fill={b.hue}
              rx={10}
            />
            <text
              x={b.x1 + 14}
              y={LINE_Y - 40}
              textAnchor="start"
              className="month-label"
            >
              {b.label}
            </text>
          </g>
        ))}

        <line
          x1={-4}
          x2={todayX}
          y1={LINE_Y}
          y2={LINE_Y}
          stroke="var(--track)"
          strokeWidth={8}
          strokeLinecap="round"
        />
        <line
          x1={todayX}
          x2={1004}
          y1={LINE_Y}
          y2={LINE_Y}
          stroke="var(--track)"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray="4 10"
          opacity={0.5}
        />

        {line.dots.map((d) => (
          <circle
            key={d}
            cx={x(d)}
            cy={LINE_Y}
            r={3}
            fill="var(--card)"
            stroke="var(--track)"
            strokeWidth={2}
          />
        ))}

        {line.stops.map((s) => {
          const cx = x(s.date);
          const isHover = hovered === s.date;
          return (
            <g
              key={s.date}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(s.date)}
              onMouseLeave={() => setHovered((h) => (h === s.date ? null : h))}
              onClick={() => openStop(s.date)}
            >
              <circle
                cx={cx}
                cy={LINE_Y}
                r={isHover ? 9 : 7}
                fill="var(--card)"
                stroke="var(--track)"
                strokeWidth={3}
              />
              {isHover && (
                <text
                  x={cx}
                  y={LINE_Y + 28}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={700}
                  letterSpacing={1}
                  fill="var(--ink)"
                  fontFamily="var(--display)"
                >
                  {shortDate(s.date).toUpperCase()}
                </text>
              )}
            </g>
          );
        })}

        {line.future_stops.map((f) => {
          const cx = x(f.date);
          const isUrgent = f.tag.includes("!");
          const stroke = isUrgent ? "var(--urgent)" : "var(--track)";
          return (
            <g key={`${f.date}-${f.text}`}>
              <circle
                cx={cx}
                cy={LINE_Y}
                r={7}
                fill="var(--card)"
                stroke={stroke}
                strokeWidth={3}
              />
              <text
                x={cx}
                y={LINE_Y - 18}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={isUrgent ? "var(--urgent)" : "var(--ink)"}
                fontFamily="var(--display)"
              >
                {f.text.length > 22 ? f.text.slice(0, 20) + "…" : f.text}
              </text>
              <text
                x={cx}
                y={LINE_Y + 28}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                letterSpacing={1}
                fill="var(--ink-soft)"
                fontFamily="var(--display)"
              >
                {shortDate(f.date).toUpperCase()}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${todayX}, ${LINE_Y})`}>
          <circle r={12} fill="var(--train)" stroke="var(--ink)" strokeWidth={3} />
          <circle r={12} fill="none" stroke="var(--train)" strokeWidth={2} opacity={0.35}>
            <animate attributeName="r" values="12;20;12" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="3s" repeatCount="indefinite" />
          </circle>
          <text
            y={-24}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            letterSpacing={2}
            fill="var(--train)"
            fontFamily="var(--display)"
          >
            TODAY
          </text>
        </g>
      </svg>

      {detail && (
        <StopPopover
          date={detail.date}
          stop={detail.stop}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function StopPopover({
  date,
  stop,
  onClose,
}: {
  date: string;
  stop: Stop | null;
  onClose: () => void;
}) {
  return (
    <div
      className="stop-popover"
      style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}
    >
      <div className="date">{shortDate(date)}</div>
      <div className="summary">
        {stop?.summary ?? <span className="quiet">no summary yet.</span>}
      </div>
      <div className="link">
        {stop?.journal_deeplink ? (
          <a href={stop.journal_deeplink}>open in heptabase →</a>
        ) : (
          <span className="quiet">journal not linked</span>
        )}
      </div>
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <button onClick={onClose}>close</button>
      </div>
    </div>
  );
}
