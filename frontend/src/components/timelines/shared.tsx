// Shared vocabulary for the /timelines lab: one data model, one scale,
// and the "train stop" glyphs (open-circle spans, diamonds, task dots).
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import type { CaughtItem, LineView, RoadmapEntry, RoadmapLane } from "@life-console/shared";

// ---------- dates ----------
export const DAY_MS = 86_400_000;
export const parse = (d: string) => new Date(d + "T00:00:00");
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d: string, n: number) => {
  const dt = parse(d);
  dt.setDate(dt.getDate() + n);
  return iso(dt);
};
export const dayDiff = (a: string, b: string) =>
  Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
export const fmt = (d: string, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  parse(d).toLocaleDateString("en-US", o);
export const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);

// ---------- model ----------
export interface Lane { id: number; name: string; color: string }
export interface Span {
  id: string; laneId: number; title: string; kind: "span" | "milestone";
  start: string; end: string; color: string;
  theme: string | null; notes: string | null; published: boolean;
}
export interface Task {
  id: string; laneId: number | null; title: string; date: string; tags: string[];
  assignee: string | null;
  linear: { identifier: string; state: string | null; team: string | null } | null;
  deeplink: string | null; urgent: boolean; done: boolean;
}
export interface Model {
  today: string; lanes: Lane[]; spans: Span[]; tasks: Task[];
  stops: string[]; // past journaled days → open circles on the spine
  dots: string[]; // older compressed days
}
export type Selected =
  | { kind: "span"; span: Span }
  | { kind: "task"; task: Task }
  | { kind: "station"; date: string; spans: Span[]; tasks: Task[] };
export type Pick = (sel: Selected, e: MouseEvent) => void;

export const LANE_PALETTE = ["#e5352a", "#7c3aed", "#2b6cb0", "#0f9d58", "#f2a63a", "#d9488a", "#0e7490", "#8f8a82"];
const DB_DEFAULT_LANE_COLOR = "#547a68";
export const laneOf = (m: Model, id: number | null) => m.lanes.find((l) => l.id === id) ?? null;
export const laneColor = (m: Model, id: number | null) => laneOf(m, id)?.color ?? "#8f8a82";
export const spansOverlapping = (m: Model, from: string, to: string) =>
  m.spans.filter((s) => s.start <= to && s.end >= from);

// Tasks auto-join a lane when one of their tags matches the lane name.
export function fromApi(line: LineView, lanes: RoadmapLane[], entries: RoadmapEntry[], items: CaughtItem[]): Model {
  // lanes created before colors were editable carry the schema default; give those the palette
  const L = lanes.map((l, i) => ({ id: l.id, name: l.name, color: l.color && l.color !== DB_DEFAULT_LANE_COLOR ? l.color : LANE_PALETTE[i % LANE_PALETTE.length] }));
  const byName = new Map(L.map((l) => [l.name.toLowerCase().replace(/^#/, ""), l.id]));
  return {
    today: line.today,
    lanes: L,
    spans: entries.map((e) => ({
      id: `r${e.id}`, laneId: e.lane_id, title: e.title, kind: e.kind,
      start: e.start_date, end: e.end_date ?? e.start_date, color: e.color,
      theme: e.theme, notes: e.notes, published: e.published,
    })),
    tasks: items
      .filter((i) => i.kind === "task" && i.due_date)
      .map((i) => {
        // explicit tags win over the primary catch tag so "set lane" is deterministic
        const tags = [...new Set([...i.tags, i.tag].filter(Boolean).map((t) => t.replace(/^#/, "").toLowerCase()))];
        return {
          id: `t${i.id}`, title: i.text, date: i.due_date!, tags,
          laneId: tags.map((t) => byName.get(t)).find((id) => id !== undefined) ?? null,
          assignee: i.assignee,
          linear: i.linear_identifier
            ? { identifier: i.linear_identifier, state: i.linear_state, team: i.linear_team }
            : null,
          deeplink: i.source_deeplink,
          urgent: i.priority === 1 || i.tag.includes("!"),
          done: i.status === "closed",
        };
      }),
    stops: line.stops.map((s) => s.date),
    dots: line.dots,
  };
}


// ---------- scale ----------
export interface Scale {
  from: string; days: number; dayW: number; width: number; dates: string[];
  x: (d: string) => number;
}
export function makeScale(from: string, days: number, dayW: number): Scale {
  return {
    from, days, dayW, width: days * dayW,
    dates: Array.from({ length: days }, (_, i) => addDays(from, i)),
    x: (d) => (dayDiff(from, d) + 0.5) * dayW,
  };
}
export const inWindow = (s: Scale, d: string) => {
  const i = dayDiff(s.from, d);
  return i >= 0 && i < s.days;
};
const clampX = (s: Scale, d: string) => Math.max(0, Math.min(s.width, s.x(d)));

// Greedy row packing so overlapping spans (and their labels) stack.
export function packRows<T extends { start: string; end: string }>(items: T[], padDays = 3) {
  const ends: string[] = [];
  return [...items]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((item) => {
      let row = 0;
      while (ends[row] !== undefined && ends[row] >= addDays(item.start, -padDays)) row++;
      ends[row] = item.end;
      return { item, row };
    });
}
export const rowCount = (packed: { row: number }[]) => (packed.length ? Math.max(...packed.map((p) => p.row)) + 1 : 1);

// ---------- hooks ----------
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}


// ---------- glyphs ----------
const F = { display: "var(--display)", mono: "var(--mono)" };

/** Level of detail from pixels-per-day: 3 daily · 2 daily ticks, Monday numbers · 1 weekly · 0 monthly. */
export const lodOf = (dayW: number) => (dayW >= 14 ? 3 : dayW >= 6 ? 2 : dayW >= 2.5 ? 1 : 0);

/** The spine: month/year dividers, ticks, day numbers, solid past / dashed future, stops, today. */
export function Axis({ s, y, m, labelToday = true }: { s: Scale; y: number; m: Model; labelToday?: boolean }) {
  const todayX = s.x(m.today);
  const w = s.dayW;
  const lod = lodOf(w);
  const monthW = 30 * w;
  const MON: Intl.DateTimeFormatOptions = { month: monthW >= 90 ? "long" : "short" };
  const monthText = (dt: Date, withYear: boolean) =>
    monthW < 26 ? (dt.getMonth() === 0 || withYear ? String(dt.getFullYear()) : "") // too tight: only years
    : `${dt.toLocaleString("en-US", MON)}${withYear || dt.getMonth() === 0 ? ` ${dt.getFullYear()}` : ""}`;
  const firstDivider = s.dates.findIndex((d) => parse(d).getDate() === 1);
  const showEdgeLabel = firstDivider === -1 || firstDivider * w > 70; // no divider near the left edge → label the edge
  const stopR = w >= 6 ? 4.5 : w >= 2.5 ? 2.5 : 1.5;
  const stopStroke = w >= 6 ? 2 : 1.2;
  return (
    <g>
      {showEdgeLabel && (
        <text x={4} y={y - 38} fontSize={13} fontFamily={F.display} fontWeight={600} fill="var(--tl-muted)">
          {monthText(parse(s.from), true)}
        </text>
      )}
      {s.dates.map((d) => {
        const dt = parse(d);
        const mon = dt.getDay() === 1;
        const first = dt.getDate() === 1;
        const x = s.x(d);
        const tick = lod >= 2 || (lod === 1 && mon) || first;
        const num = lod === 3 || (lod === 2 && mon) || (lod === 1 && mon && w >= 4);
        const jan = dt.getMonth() === 0;
        return (
          <g key={d}>
            {first && (
              <>
                <line x1={x - w / 2} x2={x - w / 2} y1={y - 50} y2={y + 30} stroke={jan ? "var(--tl-muted)" : "var(--tl-divider)"} strokeDasharray={jan ? undefined : "2 3"} strokeWidth={jan ? 1.5 : 1} />
                <text x={x - w / 2 + 6} y={y - 38} fontSize={13} fontFamily={F.display} fontWeight={jan ? 700 : 600} fill="var(--tl-ink)">
                  {monthText(dt, false)}
                </text>
              </>
            )}
            {tick && !first && (
              <line x1={x} x2={x} y1={y - (mon ? 6 : 4)} y2={y + (mon ? 8 : 5)} stroke="var(--tl-track)"
                strokeWidth={mon ? 1.5 : 1} opacity={lod >= 2 ? (mon ? 0.65 : 0.35) : 0.5} />
            )}
            {num && (
              <text x={x} y={y + 22} textAnchor="middle" fontSize={mon ? 10 : 9} fontWeight={mon ? 700 : 400}
                fill={mon ? "var(--tl-ink)" : "var(--tl-muted)"} fontFamily={F.mono}>
                {dt.getDate()}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={clampX(s, m.today)} y1={y} y2={y} stroke="var(--tl-track)" strokeWidth={3} strokeLinecap="round" />
      <line x1={clampX(s, m.today)} x2={s.width} y1={y} y2={y} stroke="var(--tl-track)" strokeWidth={3} strokeDasharray="3 6" opacity={0.5} strokeLinecap="round" />
      {w >= 4 && m.dots.filter((d) => inWindow(s, d)).map((d) => <circle key={d} cx={s.x(d)} cy={y} r={2.5} fill="var(--tl-track)" />)}
      {m.stops.filter((d) => inWindow(s, d)).map((d) => (
        <circle key={d} cx={s.x(d)} cy={y} r={stopR} fill="#fff" stroke="var(--tl-track)" strokeWidth={stopStroke} />
      ))}
      {!inWindow(s, m.today) && labelToday && (
        <text x={todayX < 0 ? 4 : s.width - 4} y={y + 46} textAnchor={todayX < 0 ? "start" : "end"} fontSize={11}
          fontFamily={F.display} fontWeight={600} fill="var(--accent)">
          {todayX < 0 ? `◂ today · ${fmt(m.today)} · ${dayDiff(m.today, s.from)}d back` : `today · ${fmt(m.today)} · ${dayDiff(addDays(s.from, s.days - 1), m.today)}d ahead ▸`}
        </text>
      )}
      {inWindow(s, m.today) && (
        <g>
          <circle cx={todayX} cy={y} r={6} fill="#fff" stroke="var(--accent)" strokeWidth={2.5} />
          {labelToday && (
            <text x={todayX} y={y + 46} textAnchor="middle" fontSize={12} fontFamily={F.display} fontWeight={600} fill="var(--tl-ink)">
              Today
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/** Span = thin colored line with open circles at both ends; milestone = open diamond. */
export function SpanGlyph({ s, span, y, pick, label = true, x1: fx1, x2: fx2, onPointerDown, onResizeStart }: {
  s: Scale; span: Span; y: number; pick?: Pick; label?: boolean; x1?: number; x2?: number;
  onPointerDown?: (e: RPointerEvent) => void;
  /** grab an end circle to change just that date */
  onResizeStart?: (edge: "start" | "end", e: RPointerEvent) => void;
}) {
  if (dayDiff(s.from, span.end) < 0 || dayDiff(s.from, span.start) >= s.days) return null;
  const x1 = fx1 ?? clampX(s, span.start);
  const x2 = fx2 ?? clampX(s, span.end);
  const c = span.color;
  const onClick = pick ? (e: MouseEvent) => { e.stopPropagation(); pick({ kind: "span", span }, e); } : undefined;
  if (span.kind === "milestone") {
    return (
      <g className="tlx-hit" onClick={onClick} onPointerDown={onPointerDown}>
        <circle cx={x1} cy={y} r={10} fill="transparent" />
        <path d={`M${x1},${y - 6}L${x1 + 6},${y}L${x1},${y + 6}L${x1 - 6},${y}Z`} fill="#fff" stroke={c} strokeWidth={2} />
        {label && <text x={x1} y={y - 10} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--tl-ink)" fontFamily={F.display}>{span.title}</text>}
      </g>
    );
  }
  return (
    <g className="tlx-hit" onClick={onClick} onPointerDown={onPointerDown}>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke="transparent" strokeWidth={16} />
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={c} strokeWidth={2} />
      {inWindow(s, span.start) && <circle cx={x1} cy={y} r={4.5} fill="#fff" stroke={c} strokeWidth={2} />}
      {inWindow(s, span.end) && <circle cx={x2} cy={y} r={4.5} fill="#fff" stroke={c} strokeWidth={2} />}
      {onResizeStart && inWindow(s, span.start) && (
        <circle className="tlx-handle" cx={x1} cy={y} r={8} fill="transparent" onPointerDown={(e) => onResizeStart("start", e)}><title>drag to change start</title></circle>
      )}
      {onResizeStart && inWindow(s, span.end) && (
        <circle className="tlx-handle" cx={x2} cy={y} r={8} fill="transparent" onPointerDown={(e) => onResizeStart("end", e)}><title>drag to change end</title></circle>
      )}
      {label && (
        <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--tl-ink)" fontFamily={F.display}>
          {trunc(span.title, Math.max(4, Math.floor((x2 - x1 + 40) / 5.5)))}
        </text>
      )}
    </g>
  );
}

/** Task = small filled dot in its lane color (ring when urgent, grey when done). */
export function TaskDot({ s, task, y, color, pick, label = false, below = false, x: fx, onPointerDown }: {
  s: Scale; task: Task; y: number; color: string; pick?: Pick; label?: boolean; below?: boolean; x?: number;
  onPointerDown?: (e: RPointerEvent) => void;
}) {
  if (fx === undefined && !inWindow(s, task.date)) return null;
  const x = fx ?? s.x(task.date);
  return (
    <g className="tlx-hit" onClick={(e) => { e.stopPropagation(); pick?.({ kind: "task", task }, e); }} onPointerDown={onPointerDown}>
      <circle cx={x} cy={y} r={9} fill="transparent" />
      <circle cx={x} cy={y} r={3.5} fill={task.done ? "var(--tl-muted)" : color} stroke="#fff" strokeWidth={1.5} opacity={task.done ? 0.6 : 1} />
      {task.urgent && !task.done && <circle cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={1} opacity={0.7} />}
      {label && (
        <text x={x} y={below ? y + 15 : y - 9} textAnchor="middle" fontSize={9} fill="var(--ink-soft)" fontFamily="var(--sans)">
          {trunc(task.title, 16)}
        </text>
      )}
      <title>{task.title}</title>
    </g>
  );
}

// ---------- details ----------
const LONG: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
export function dueWord(today: string, d: string) {
  const n = dayDiff(today, d);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n}d` : `${-n}d overdue`;
}
function spanWord(today: string, span: Span) {
  if (span.end < today) return `ended ${dayDiff(span.end, today)}d ago`;
  if (span.start > today) return `starts in ${dayDiff(today, span.start)}d`;
  return span.kind === "milestone" ? "today" : `day ${dayDiff(span.start, today) + 1} of ${dayDiff(span.start, span.end) + 1}`;
}

export function Chips({ task }: { task: Task }) {
  return (
    <div className="tlx-chips">
      {task.linear ? (
        <a className="tlx-chip linear" href={task.deeplink ?? "#"} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {task.linear.identifier}{task.linear.state ? ` · ${task.linear.state}` : ""}
        </a>
      ) : (
        <span className="tlx-chip">manual</span>
      )}
      {task.assignee && <span className="tlx-chip">→ {task.assignee}</span>}
      {task.urgent && <span className="tlx-chip urgent">urgent</span>}
      {task.tags.map((t) => <span key={t} className="tlx-chip hash">#{t}</span>)}
    </div>
  );
}

export function DetailBody({ sel, m }: { sel: Selected; m: Model }) {
  if (sel.kind === "span") {
    const { span } = sel;
    return (
      <>
        <div className="tlx-kicker"><i style={{ background: span.color }} />{laneOf(m, span.laneId)?.name ?? "roadmap"} · {span.kind}</div>
        <div className="tlx-title">{span.title}</div>
        <div className="tlx-meta">
          {span.kind === "milestone" ? fmt(span.start, LONG) : `${fmt(span.start)} → ${fmt(span.end)} · ${dayDiff(span.start, span.end) + 1}d`}
          {" · "}{spanWord(m.today, span)}
        </div>
        {span.theme && <div className="tlx-meta">theme · {span.theme}</div>}
        {span.notes && <p className="tlx-notes">{span.notes}</p>}
        {span.published && <span className="tlx-chip">published to company calendar</span>}
      </>
    );
  }
  if (sel.kind === "task") {
    const { task } = sel;
    const lane = laneOf(m, task.laneId);
    return (
      <>
        <div className="tlx-kicker"><i style={{ background: laneColor(m, task.laneId) }} />{lane ? `${lane.name} · task` : "task · no lane"}</div>
        <div className="tlx-title">{task.title}</div>
        <div className="tlx-meta">{task.done ? `done · was due ${fmt(task.date)}` : `due ${fmt(task.date, LONG)} · ${dueWord(m.today, task.date)}`}</div>
        <Chips task={task} />
      </>
    );
  }
  return (
    <>
      <div className="tlx-kicker">station</div>
      <div className="tlx-title">{fmt(sel.date, LONG)}</div>
      <ul className="tlx-station-list">
        {sel.spans.map((s) => (
          <li key={s.id} style={{ color: s.color }}>
            {s.kind === "milestone" ? "◇" : s.start === sel.date ? "▷ starts" : "◁ ends"} <b>{s.title}</b>
          </li>
        ))}
        {sel.tasks.map((t) => (
          <li key={t.id}>• {t.title}{t.linear && <span className="tlx-chip linear">{t.linear.identifier}</span>}</li>
        ))}
      </ul>
    </>
  );
}

export function DetailCard({ sel, m, at, onClose, children }: {
  sel: Selected; m: Model; at: { x: number; y: number }; onClose: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div ref={ref} className="tlx-card" style={{ left: Math.min(at.x + 12, window.innerWidth - 300), top: Math.min(at.y + 12, window.innerHeight - 220) }}>
      <button className="tlx-x" onClick={onClose} aria-label="close">×</button>
      <DetailBody sel={sel} m={m} />
      {children}
    </div>
  );
}

/** Fixed fullscreen shell used by every variant's "expand" action. */
export function Fullscreen({ title, hint, onClose, children }: { title: string; hint?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div className="tlx-full" role="dialog" aria-modal="true">
      <div className="tlx-full-head">
        <div><strong>{title}</strong>{hint && <span>{hint}</span>}</div>
        <button className="tlx-link" onClick={onClose}>close ×</button>
      </div>
      {children}
    </div>
  );
}
