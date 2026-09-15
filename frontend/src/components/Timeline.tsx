// The home-page timeline (lab variant 1, built for real): one spine with the
// roadmap overlaid as open-circle spans and tasks as dots. "expand" opens it
// fullscreen with a band per lane, an editable task list, and roadmap
// entry editing. Every visual choice is a persisted toggle.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { CaughtItem, LineView, RoadmapEntry, RoadmapLane, Settings } from "@life-console/shared";
import { api } from "../api.js";
import { dayDropProps } from "../dnd.js";
import { useToggle } from "../useToggle.js";
import { TaskComposer, TaskDetailModal } from "./Tasks.js";
import {
  Axis, Chips, DetailCard, Fullscreen, LANE_PALETTE, SpanGlyph, TaskDot, addDays, dayDiff, dueWord, fmt, fromApi,
  inWindow, laneColor, makeScale, packRows, rowCount, spansOverlapping, useWidth,
  type Model, type Pick, type Selected, type Span, type Task,
} from "./timelines/shared.js";
import "../timelines.css";

interface Props {
  line: LineView;
  items: CaughtItem[];
  settings: Settings;
  selectedDate: string;
  selectedRange?: { from: string; to: string };
  onSelectDate: (d: string) => void;
  onDropTask?: (itemId: number, date: string) => void;
  onChange: () => void; // tasks changed → page reloads items
}

const WEEKS = [8, 17, 26];

export function usePersisted<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; }
  });
  const set = (n: T | ((p: T) => T)) =>
    setV((p) => { const x = typeof n === "function" ? (n as (p: T) => T)(p) : n; localStorage.setItem(key, JSON.stringify(x)); return x; });
  return [v, set] as const;
}

const numId = (id: string) => Number(id.slice(1));

/* ---------------- board (svg) ---------------- */

interface BoardProps {
  m: Model; full: boolean; byLane: boolean; labels: boolean; days: number; back: number; offset: number;
  selectedDate: string; selectedRange?: { from: string; to: string };
  pick: Pick; onPickDay: (d: string) => void; onDropTask?: (id: number, date: string) => void;
  onMove: (sel: Selected, deltaDays: number) => void;
  onResize?: (span: Span, edge: "start" | "end", deltaDays: number) => void;
  onPan: (deltaDays: number) => void; onZoom: (dir: 1 | -1) => void;
  readOnly?: boolean; // mobile: tap to open, no glyph dragging
}

export function Board({ m, full, byLane, labels, days, back, offset, selectedDate, selectedRange, pick, onPickDay, onDropTask, onMove, onResize, onPan, onZoom, readOnly = false }: BoardProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const s = makeScale(addDays(m.today, offset - back), days, Math.max(1, width) / days);
  const to = addDays(s.from, days - 1);
  const vis = spansOverlapping(m, s.from, to);
  const tasks = m.tasks.filter((t) => inWindow(s, t.date));
  const moved = useRef(false);

  // wheel: horizontal (or shift+wheel) pans, ⌘/ctrl+wheel and pinch zoom.
  // Native listener because React's onWheel is passive and can't preventDefault.
  const acc = useRef({ pan: 0, zoom: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        acc.current.zoom += e.deltaY;
        if (Math.abs(acc.current.zoom) > 24) { onZoom(acc.current.zoom < 0 ? 1 : -1); acc.current.zoom = 0; }
        return;
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      acc.current.pan += dx;
      const d = Math.trunc(acc.current.pan / s.dayW);
      if (d) { acc.current.pan -= d * s.dayW; onPan(d); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, s.dayW, onPan, onZoom]);

  // drag empty board to pan (glyphs stop propagation, so they don't pan)
  const panStart = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    moved.current = false;
    let x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const d = Math.trunc((x0 - ev.clientX) / s.dayW);
      if (d) { x0 -= d * s.dayW; moved.current = true; onPan(d); }
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pickDay = (d: string) => { if (moved.current) { moved.current = false; return; } onPickDay(d); };

  // drag a dot / span sideways to move it by whole days; drag a span's end
  // circle to change just that date. Preview shifts start by d1 and end by d2.
  type Drag = { sel: Selected; edge?: "start" | "end"; x0: number; delta: number };
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; d1: number; d2: number } | null>(null);
  const clampDelta = (d: Drag, delta: number) => {
    if (d.sel.kind !== "span" || !d.edge) return delta;
    const len = dayDiff(d.sel.span.start, d.sel.span.end); // keep start <= end
    return d.edge === "start" ? Math.min(delta, len) : Math.max(delta, -len);
  };
  const beginDrag = (sel: Selected, edge: "start" | "end" | undefined) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    moved.current = false;
    dragRef.current = { sel, edge, x0: e.clientX, delta: 0 };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = clampDelta(d, Math.round((ev.clientX - d.x0) / s.dayW));
      if (delta !== d.delta) {
        d.delta = delta; moved.current = true;
        setPreview({ id: idOf(d.sel), d1: d.edge === "end" ? 0 : delta, d2: d.edge === "start" ? 0 : delta });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (!d || d.delta === 0) return;
      if (d.edge && d.sel.kind === "span") onResize?.(d.sel.span, d.edge, d.delta);
      else onMove(d.sel, d.delta);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const startDrag = (sel: Selected) => beginDrag(sel, undefined);
  const idOf = (sel: Selected) => (sel.kind === "span" ? sel.span.id : sel.kind === "task" ? sel.task.id : sel.date);
  const safePick: Pick = (sel, e) => { if (moved.current) { moved.current = false; return; } pick(sel, e); };
  const shift = (id: string) => (preview?.id === id ? preview : null);

  const grouped = full && byLane;
  const bands = (grouped
    ? m.lanes.map((lane) => ({ lane, packed: packRows(vis.filter((v) => v.laneId === lane.id)), tasks: tasks.filter((t) => t.laneId === lane.id) }))
    : [{ lane: null, packed: packRows(vis), tasks: [] as Task[] }]
  ).map((b) => ({ ...b, rows: rowCount(b.packed), top: 0 }));
  let y = grouped ? 34 : 26;
  for (const b of bands) { b.top = y; y += b.rows * 20 + (grouped ? 38 : 14); } // 14: keep the axis month label clear of the lowest span row
  const trackY = y + 36;
  const spanY = (b: (typeof bands)[number], row: number) => b.top + (b.rows - 1 - row) * 20 + 10;
  const spineTasks = grouped ? tasks.filter((t) => !t.laneId) : tasks;

  const r = selectedRange ?? { from: selectedDate, to: selectedDate };
  const bx1 = Math.max(0, s.x(r.from) - s.dayW / 2);
  const bx2 = Math.min(s.width, s.x(r.to) + s.dayW / 2);

  const showLabels = labels && s.dayW >= 4; // zoomed far out: shapes only
  const spanGlyph = (sp: Span, yy: number) => {
    const p = shift(sp.id);
    const canResize = !readOnly && onResize && sp.kind === "span" && s.dayW >= 3;
    return (
      <SpanGlyph key={sp.id} s={s} span={sp} y={yy} pick={safePick} label={showLabels}
        x1={p ? s.x(addDays(sp.start, p.d1)) : undefined} x2={p ? s.x(addDays(sp.end, p.d2)) : undefined}
        onPointerDown={readOnly ? undefined : startDrag({ kind: "span", span: sp })}
        onResizeStart={canResize ? (edge, e) => beginDrag({ kind: "span", span: sp }, edge)(e) : undefined} />
    );
  };
  const taskGlyph = (t: Task, yy: number, label: boolean) => {
    const p = shift(t.id);
    return (
      <TaskDot key={t.id} s={s} task={t} y={yy} color={laneColor(m, t.laneId)} pick={safePick} label={label} below
        x={p ? s.x(addDays(t.date, p.d1)) : undefined} onPointerDown={readOnly ? undefined : startDrag({ kind: "task", task: t })} />
    );
  };

  return (
    <div ref={ref} className="tlx-board">
      {width > 0 && (
        <svg width={width} height={trackY + 58} style={{ display: "block", overflow: "visible" }} className="tl-svg" onPointerDown={panStart}>
          {/* selected period: a band from just above the ticks down through the day numbers */}
          {bx2 > bx1 && <rect x={bx1} y={trackY - 9} width={bx2 - bx1} height={36} rx={3} fill="var(--accent)" opacity={0.1} />}
          {s.dates.map((d) => (
            <rect key={d} className="tlx-slot" x={s.x(d) - s.dayW / 2} y={trackY - 46} width={s.dayW} height={78}
              onClick={() => pickDay(d)} {...(onDropTask ? dayDropProps(d, onDropTask, "drop-over-day") : {})}>
              <title>{fmt(d)}</title>
            </rect>
          ))}
          <g style={{ pointerEvents: "none" }}><Axis s={s} y={trackY} m={m} /></g>
          {bands.map((b, i) => (
            <g key={b.lane?.id ?? i}>
              {b.lane && (
                <>
                  <line x1={0} x2={s.width} y1={spanY(b, 0)} y2={spanY(b, 0)} stroke={b.lane.color} strokeWidth={1} strokeDasharray="1 4" opacity={0.35} />
                  <text x={0} y={b.top - 12} fontSize={10} fontWeight={700} letterSpacing={1.2} fill={b.lane.color} fontFamily="var(--display)">
                    {b.lane.name.toUpperCase()}
                  </text>
                </>
              )}
              {b.packed.map(({ item, row }) => spanGlyph(item, spanY(b, row)))}
              {b.tasks.map((t) => taskGlyph(t, spanY(b, 0), showLabels && s.dayW >= 6))}
            </g>
          ))}
          {spineTasks.map((t) => taskGlyph(t, trackY, (full || readOnly) && showLabels && s.dayW >= 6))}
        </svg>
      )}
    </div>
  );
}

/* ---------------- roadmap entry editor ---------------- */

// on/off pill in the board's stop vocabulary: filled circle = on, open ring = off
export function Toggle({ on, toggle, label }: { on: boolean; toggle: () => void; label: string }) {
  return (
    <button type="button" className={`tl-toggle ${on ? "on" : ""}`} onClick={toggle} aria-pressed={on}><i />{label}</button>
  );
}

export type Draft = Omit<RoadmapEntry, "id"> & { id?: number };

export function SpanEditor({ draft, lanes, onClose, onSaved }: { draft: Draft; lanes: RoadmapLane[]; onClose: () => void; onSaved: (saved: Draft) => void }) {
  const [d, setD] = useState(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  // drag the box by its title bar so the timeline stays visible
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const grab = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: PointerEvent) => setPos({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const save = async () => {
    if (!d.title.trim()) return;
    const body = { ...d, title: d.title.trim(), end_date: d.kind === "span" ? d.end_date ?? d.start_date : null };
    if (d.id) await api.updateRoadmapEntry(d.id, body);
    else await api.addRoadmapEntry(body);
    onSaved(body);
  };
  return (
    <div className="linear-modal-overlay tl-editor-overlay" onClick={onClose}>
      <div className="linear-modal tl-editor" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <div className="linear-modal-title tl-editor-grip" onPointerDown={grab} title="drag to move">
          {d.id ? "edit" : "new"} {d.kind}<span className="tlx-hint">⋮⋮ drag</span>
        </div>
        <label>title<input autoFocus value={d.title} onChange={(e) => set("title", e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} /></label>
        <div className="linear-modal-grid">
          <label>lane
            <select value={d.lane_id} onChange={(e) => set("lane_id", Number(e.target.value))}>
              {lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>kind
            <select value={d.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])}>
              <option value="span">span</option><option value="milestone">milestone</option>
            </select>
          </label>
          <label>start<input type="date" value={d.start_date} onChange={(e) => set("start_date", e.target.value)} /></label>
          {d.kind === "span" && (
            <label>end<input type="date" min={d.start_date} value={d.end_date ?? d.start_date} onChange={(e) => set("end_date", e.target.value)} /></label>
          )}
          <label>color<input type="color" value={d.color} onChange={(e) => set("color", e.target.value)} /></label>
          <label>theme<input value={d.theme ?? ""} placeholder="optional" onChange={(e) => set("theme", e.target.value || null)} /></label>
        </div>
        <label>notes<textarea rows={3} value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} /></label>
        <label className="tlx-check"><input type="checkbox" checked={d.published} onChange={(e) => set("published", e.target.checked)} /> publish to company calendar</label>
        <div className="linear-modal-actions">
          {d.id && <button className="danger" onClick={async () => { await api.deleteRoadmapEntry(d.id!); onSaved({ ...d, published: false }); }}>delete</button>}
          <button onClick={onClose}>cancel</button>
          <button className="primary" disabled={!d.title.trim()} onClick={() => void save()}>save</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- main ---------------- */

/* ---------------- lane popover (rename · color · delete) ---------------- */

function LanePopover({ lane, spanCount, at, onClose, onSaved }: {
  lane: RoadmapLane | null; spanCount: number; at: { x: number; y: number }; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(lane?.name ?? "");
  const [color, setColor] = useState(lane?.color ?? LANE_PALETTE[0]);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);
  const save = async () => {
    if (!name.trim()) return;
    if (lane) await api.updateRoadmapLane(lane.id, { name: name.trim(), color });
    else await api.addRoadmapLane({ name: name.trim(), color });
    onSaved();
  };
  return (
    <div ref={ref} className="tlx-card tl-lanepop" style={{ left: Math.min(at.x, window.innerWidth - 280), top: at.y + 8 }}>
      <div className="tlx-kicker"><i style={{ background: color }} />{lane ? "lane" : "new lane"}</div>
      <input autoFocus value={name} placeholder="name — tasks tagged #name join this lane" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()} />
      <div className="tl-swatches">
        {LANE_PALETTE.map((c) => (
          <button key={c} className={c === color ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
        <label className="tl-swatch-custom" title="custom"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
      <div className="tlx-actions">
        {lane && !confirm && <button className="danger" onClick={() => setConfirm(true)}>delete</button>}
        {lane && confirm && (
          <button className="danger" onClick={async () => { await api.deleteRoadmapLane(lane.id); onSaved(); }}>
            really delete{spanCount ? ` + ${spanCount} span${spanCount === 1 ? "" : "s"}` : ""}?
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => void save()}>save</button>
      </div>
    </div>
  );
}

/* ---------------- main ---------------- */

export function Timeline({ line, items, settings, selectedDate, selectedRange, onSelectDate, onDropTask, onChange }: Props) {
  const [lanes, setLanes] = useState<RoadmapLane[]>([]);
  const [entries, setEntries] = useState<RoadmapEntry[]>([]);
  const loadRoadmap = useCallback(async () => {
    const [l, e] = await Promise.all([api.roadmapLanes(), api.roadmapEntries(addDays(line.today, -1500), addDays(line.today, 1500))]);
    setLanes(l);
    setEntries(e);
  }, [line.today]);
  useEffect(() => { loadRoadmap().catch(console.error); }, [loadRoadmap]);

  // toggles — all persisted
  const [showTasks, toggleTasks] = useToggle("tl.tasks", true);
  const [overlay, toggleOverlay] = useToggle("tl.overlay", true);
  const [showDone, toggleDone] = useToggle("tl.done", false);
  const [labels, toggleLabels] = useToggle("tl.labels", true);
  const [stops, toggleStops] = useToggle("tl.stops", true);
  const [byLane, toggleByLane] = useToggle("tl.byLane", true);
  const [hiddenLanes, setHiddenLanes] = usePersisted<number[]>("tl.hiddenLanes", []);
  const [cdays, setCdays] = usePersisted<number>("tl.days.compact", 52);
  const [fdays, setFdays] = usePersisted<number>("tl.days.full", 119);

  const [offset, setOffset] = useState(0);
  const [full, setFull] = useState(false);
  // window = today + offset, anchored at 58% (compact) / 40% (full) of the width;
  // zooming changes `days` around that anchor so the view doesn't lurch.
  const days = full ? fdays : cdays;
  const back = Math.round(days * (full ? 0.4 : 0.58));
  const pan = useCallback((d: number) => setOffset((o) => o + d), []);
  const zoom = useCallback((dir: 1 | -1) => {
    const set = full ? setFdays : setCdays;
    set((n) => Math.max(14, Math.min(400, Math.round(n * (dir > 0 ? 1 / 1.25 : 1.25)))));
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<{ sel: Selected; x: number; y: number } | null>(null);
  const [editTask, setEditTask] = useState<CaughtItem | null>(null);
  const [editSpan, setEditSpan] = useState<Draft | null>(null);
  const [lanePop, setLanePop] = useState<{ lane: RoadmapLane | null; x: number; y: number } | null>(null);
  const [composing, setComposing] = useState(false);

  // one-shot undo for drag moves / resizes — a nudge on a trackpad is easy to miss
  type Toast = { label: string; action?: { text: string; run: () => Promise<void> } };
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number>(0);
  const showToast = (t: Toast, ms = 7000) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };
  const offerUndo = (label: string, revert: () => Promise<void>) =>
    showToast({ label, action: { text: "undo", run: async () => { await revert(); await changed(); } } });

  // company calendar: preview, confirm, then push published spans/milestones
  const [syncing, setSyncing] = useState(false);
  const syncPublished = async () => {
    setSyncing(true);
    try {
      const p = await api.publishRoadmap(true);
      const n = p.created + p.updated + p.deleted;
      if (n === 0) { showToast({ label: "company calendar is up to date" }, 4000); return; }
      showToast({
        label: `calendar: create ${p.created} · update ${p.updated} · delete ${p.deleted}`,
        action: { text: "publish", run: async () => {
          const r = await api.publishRoadmap(false);
          showToast({ label: `published · ${r.created} created · ${r.updated} updated · ${r.deleted} deleted` }, 5000);
        } },
      }, 20000);
    } catch (e) {
      console.error(e);
      showToast({ label: "calendar sync failed" }, 5000);
    } finally { setSyncing(false); }
  };

  const m = useMemo(() => fromApi(line, lanes, entries, items), [line, lanes, entries, items]);
  const mf: Model = useMemo(() => ({
    ...m,
    spans: overlay ? m.spans.filter((s) => !hiddenLanes.includes(s.laneId)) : [],
    tasks: showTasks ? m.tasks.filter((t) => (showDone || !t.done) && (t.laneId === null || !hiddenLanes.includes(t.laneId))) : [],
    stops: stops ? m.stops : [],
    dots: stops ? m.dots : [],
  }), [m, overlay, showTasks, showDone, stops, hiddenLanes]);

  // keep the selected date in view when the page navigates
  useEffect(() => {
    const i = dayDiff(addDays(m.today, offset - back), selectedDate);
    if (i < 0 || i >= days) setOffset(dayDiff(m.today, selectedDate));
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick: Pick = useCallback((sel, e) => setPicked({ sel, x: e.clientX, y: e.clientY }), []);
  const closeCard = useCallback(() => setPicked(null), []);
  const itemOf = (t: Task) => items.find((i) => i.id === numId(t.id)) ?? null;
  const changed = async () => { setPicked(null); onChange(); await loadRoadmap(); };

  const moveSel = async (sel: Selected, delta: number) => {
    if (sel.kind === "task") {
      const t = sel.task;
      await api.updateItem(numId(t.id), { due_date: addDays(t.date, delta) });
      offerUndo(`${t.title} → ${fmt(addDays(t.date, delta))}`, () => api.updateItem(numId(t.id), { due_date: t.date }).then(() => {}));
    } else if (sel.kind === "span") {
      const sp = sel.span;
      const before = { start_date: sp.start, end_date: sp.kind === "span" ? sp.end : null };
      await api.updateRoadmapEntry(numId(sp.id), { start_date: addDays(sp.start, delta), end_date: sp.kind === "span" ? addDays(sp.end, delta) : null });
      offerUndo(`${sp.title} → ${fmt(addDays(sp.start, delta))}`, () => api.updateRoadmapEntry(numId(sp.id), before).then(() => {}));
    }
    await changed();
  };
  const resizeSpan = async (sp: Span, edge: "start" | "end", delta: number) => {
    const patch = edge === "start" ? { start_date: addDays(sp.start, delta) } : { end_date: addDays(sp.end, delta) };
    await api.updateRoadmapEntry(numId(sp.id), patch);
    offerUndo(`${sp.title} ${edge} → ${fmt(edge === "start" ? patch.start_date! : patch.end_date!)}`,
      () => api.updateRoadmapEntry(numId(sp.id), edge === "start" ? { start_date: sp.start } : { end_date: sp.end }).then(() => {}));
    await changed();
  };
  const rollToToday = async (t: Task) => { await api.updateItem(numId(t.id), { due_date: m.today }); await changed(); };
  const setLane = async (t: Task, laneId: number | null) => {
    const laneNames = m.lanes.map((l) => l.name.toLowerCase());
    const keep = t.tags.filter((x) => !laneNames.includes(x));
    const lane = m.lanes.find((l) => l.id === laneId);
    await api.updateItem(numId(t.id), { tags: lane ? [lane.name, ...keep] : keep });
    await changed();
  };
  const toDraft = (sp: Span): Draft => {
    const e = entries.find((x) => x.id === numId(sp.id))!;
    return { ...e };
  };
  const newDraft = (kind: Draft["kind"]): Draft => ({
    lane_id: lanes[0]?.id ?? 0, title: "", kind, start_date: selectedDate,
    end_date: kind === "span" ? addDays(selectedDate, 6) : null,
    notes: null, theme: null, color: laneColor(m, lanes[0]?.id ?? null), row_position: null,
    transparent: false, opacity: 1, published: false,
  });

  const board = (isFull: boolean) => {
    const dd = isFull ? fdays : cdays;
    return (
      <Board m={mf} full={isFull} byLane={byLane} labels={labels} days={dd} back={Math.round(dd * (isFull ? 0.4 : 0.58))}
        offset={offset} selectedDate={selectedDate} selectedRange={selectedRange} pick={pick} onPickDay={onSelectDate}
        onDropTask={onDropTask} onMove={(sel, d) => void moveSel(sel, d)} onResize={(sp, edge, d) => void resizeSpan(sp, edge, d)}
        onPan={pan} onZoom={zoom} />
    );
  };

  // fullscreen keyboard: ←/→ pan a week, −/+ zoom, t today (not while typing or in a modal)
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || editTask || editSpan || lanePop) return;
      if (e.key === "ArrowLeft") pan(-7);
      else if (e.key === "ArrowRight") pan(7);
      else if (e.key === "-" || e.key === "_") zoom(-1);
      else if (e.key === "+" || e.key === "=") zoom(1);
      else if (e.key === "t") { setOffset(0); onSelectDate(m.today); }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [full, editTask, editSpan, lanePop, pan, zoom, m.today, onSelectDate]);
  const zoomButtons = (
    <div className="tlx-seg" title="zoom · ⌘+wheel or pinch also works">
      <button onClick={() => zoom(-1)} disabled={days >= 400}>−</button>
      <span className="tl-days">{days}d</span>
      <button onClick={() => zoom(1)} disabled={days <= 14}>+</button>
    </div>
  );

  const openLane = (lane: RoadmapLane | null, e: { currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setLanePop({ lane, x: r.left, y: r.bottom });
  };
  const laneChips = (
    <div className="tl-lanes">
      {m.lanes.map((l) => {
        const off = hiddenLanes.includes(l.id);
        return (
          <button key={l.id} className={`tl-lane-chip ${off ? "off" : ""}`} style={{ color: l.color }}
            onClick={() => setHiddenLanes((h) => (off ? h.filter((x) => x !== l.id) : [...h, l.id]))}
            onDoubleClick={(e) => openLane({ ...lanes.find((x) => x.id === l.id)!, color: l.color }, e)}
            title={`click to ${off ? "show" : "hide"} · double-click to rename / recolor / delete`}>
            <i style={{ background: off ? "transparent" : l.color, borderColor: l.color }} />{l.name}
          </button>
        );
      })}
      <button className="tl-lane-chip add" onClick={(e) => openLane(null, e)} title="add a lane">+ lane</button>
    </div>
  );
  const check = (on: boolean, toggle: () => void, label: string) => <Toggle on={on} toggle={toggle} label={label} />;

  // ---- lower panel: everything in the window, filterable ----
  const [kindFilter, setKindFilter] = usePersisted<"all" | "tasks" | "spans" | "milestones">("tl.panelKind", "all");
  const [q, setQ] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const winFrom = addDays(m.today, offset - back);
  const winTo = addDays(winFrom, days - 1);
  const laneName = (id: number | null) => (m.lanes.find((l) => l.id === id)?.name ?? "").toLowerCase();
  const panelTasks = m.tasks.filter((t) => (showDone || !t.done) && (t.laneId === null || !hiddenLanes.includes(t.laneId)) && t.date >= winFrom && t.date <= winTo);
  const panelSpans = spansOverlapping(m, winFrom, winTo).filter((s) => !hiddenLanes.includes(s.laneId));
  const allTags = [...new Set([...panelTasks.flatMap((t) => t.tags), ...panelSpans.map((s) => s.theme?.toLowerCase() ?? "").filter(Boolean)])].sort();
  const needle = q.trim().toLowerCase();
  const matches = (hay: string[], tags: string[]) =>
    (!needle || hay.some((h) => h.toLowerCase().includes(needle))) && (!activeTags.length || tags.some((t) => activeTags.includes(t)));
  type PanelRow = { date: string; task?: Task; span?: Span };
  const panelRows: PanelRow[] = [
    ...(kindFilter === "all" || kindFilter === "tasks" ? panelTasks.filter((t) => matches([t.title, laneName(t.laneId), ...t.tags.map((x) => "#" + x)], t.tags)).map((task) => ({ date: task.date, task })) : []),
    ...(kindFilter === "all" || kindFilter === "spans" || kindFilter === "milestones"
      ? panelSpans
          .filter((s) => kindFilter === "all" || (kindFilter === "spans" ? s.kind === "span" : s.kind === "milestone"))
          .filter((s) => matches([s.title, s.theme ?? "", laneName(s.laneId), s.kind], s.theme ? [s.theme.toLowerCase()] : []))
          .map((span) => ({ date: span.start, span }))
      : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const laneSelect = (value: number | null, onPick: (id: number | null) => void, allowNone: boolean) => (
    <select value={value ?? ""} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}>
      {allowNone && <option value="">no lane</option>}
      {m.lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );

  return (
    <div className="tl">
      <div className="tlx-top">
        <button className="tlx-link" onClick={() => setFull(true)}>expand ↗</button>
        {laneChips}
        <div className="tlx-toggles">
          {check(showTasks, toggleTasks, "tasks")}
          {check(overlay, toggleOverlay, "roadmap")}
          {offset !== 0 && <button className="tlx-link" onClick={() => setOffset(0)}>↺ today</button>}
          {zoomButtons}
        </div>
      </div>
      {board(false)}

      {full && (
        <Fullscreen title="timeline" hint="drag the board or ← → to pan · ⌘+wheel or − + to zoom · t today · drag a dot or span to move it, a span's end circle to resize · esc to close" onClose={() => setFull(false)}>
          <div className="tlx-top tl-toolbar">
            <div className="tlx-nav">
              <button onClick={() => setOffset((o) => o - Math.round(days / 4))}>‹</button>
              <button onClick={() => { setOffset(0); onSelectDate(m.today); }}>today</button>
              <button onClick={() => setOffset((o) => o + Math.round(days / 4))}>›</button>
            </div>
            <div className="tlx-seg">
              {WEEKS.map((w) => <button key={w} className={fdays === w * 7 ? "active" : ""} onClick={() => setFdays(w * 7)}>{w}w</button>)}
            </div>
            {zoomButtons}
            <span className="tlx-hint tl-range">{fmt(winFrom, { month: "short", day: "numeric", year: "numeric" })} → {fmt(winTo, { month: "short", day: "numeric", year: "numeric" })}</span>
            {laneChips}
            <div className="tlx-toggles">
              {check(showTasks, toggleTasks, "tasks")}
              {check(showDone, toggleDone, "done")}
              {check(overlay, toggleOverlay, "roadmap")}
              {check(byLane, toggleByLane, "by lane")}
              {check(labels, toggleLabels, "labels")}
              {check(stops, toggleStops, "journal stops")}
            </div>
          </div>
          <div className="tl-card">{board(true)}</div>

          <div className="tl-card tl-panel">
            <div className="tl-panel-head">
              <div className="tlx-seg">
                {(["all", "tasks", "spans", "milestones"] as const).map((k) => (
                  <button key={k} className={kindFilter === k ? "active" : ""} onClick={() => setKindFilter(k)}>{k}</button>
                ))}
              </div>
              <input className="tl-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter · title, #tag, theme, lane" />
              {allTags.length > 0 && (
                <div className="tl-tags">
                  {allTags.map((t) => (
                    <button key={t} className={`tlx-chip hash ${activeTags.includes(t) ? "on" : ""}`}
                      onClick={() => setActiveTags((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))}>#{t}</button>
                  ))}
                </div>
              )}
              <div className="tlx-nav tl-panel-add">
                <button className={composing ? "active" : ""} onClick={() => setComposing((c) => !c)}>{composing ? "× task" : "+ task"}</button>
                <button onClick={() => setEditSpan(newDraft("span"))}>+ span</button>
                <button onClick={() => setEditSpan(newDraft("milestone"))}>+ milestone</button>
                <button onClick={() => void syncPublished()} disabled={syncing} title="push published spans + milestones to the company calendar (previews first)">
                  {syncing ? "checking…" : "↑ sync calendar"}
                </button>
              </div>
            </div>
            {composing && (
              <div className="tl-compose">
                <TaskComposer key={selectedDate} settings={settings} compact initialDue={selectedDate} onCreated={() => { setComposing(false); void changed(); }} />
              </div>
            )}
            <div className="tlx-kicker">{panelRows.length} in view · {fmt(winFrom)} → {fmt(winTo)}</div>
            {panelRows.length === 0 && <div className="tlx-hint">nothing here — add a span or milestone, or drag tasks from the board onto a day</div>}
            {panelRows.map(({ task: t, span: sp }) => {
              if (t) {
                const item = itemOf(t);
                return (
                  <div key={t.id} className={`tl-task ${t.done ? "done" : ""} ${t.date < m.today && !t.done ? "overdue" : ""}`}>
                    <input type="checkbox" checked={t.done} onChange={async () => { await (t.done ? api.reopenItem(numId(t.id)) : api.closeItem(numId(t.id))); await changed(); }} />
                    <button className="tl-task-title" onClick={() => item && setEditTask(item)} title="edit">{t.title}</button>
                    <span className="tl-task-due" style={{ color: laneColor(m, t.laneId) }}>{fmt(t.date, { weekday: "short", month: "short", day: "numeric" })} · {dueWord(m.today, t.date)}</span>
                    {t.date < m.today && !t.done && <button className="tl-roll" onClick={() => void rollToToday(t)} title="move to today">→ today</button>}
                    {laneSelect(t.laneId, (id) => void setLane(t, id), true)}
                    <Chips task={t} />
                  </div>
                );
              }
              if (!sp) return null;
              const len = dayDiff(sp.start, sp.end) + 1;
              return (
                <div key={sp.id} className={`tl-task ${sp.end < m.today ? "done" : ""}`}>
                  <span className="tl-glyph" style={{ color: sp.color }}>{sp.kind === "milestone" ? "◇" : "—"}</span>
                  <button className="tl-task-title" onClick={() => setEditSpan(toDraft(sp))} title="edit">{sp.title}</button>
                  <span className="tl-task-due" style={{ color: sp.color }}>
                    {sp.kind === "milestone" ? `${fmt(sp.start, { weekday: "short", month: "short", day: "numeric" })} · ${dueWord(m.today, sp.start)}` : `${fmt(sp.start)} → ${fmt(sp.end)} · ${len}d`}
                  </span>
                  {laneSelect(sp.laneId, async (id) => { if (id) { await api.updateRoadmapEntry(numId(sp.id), { lane_id: id }); await changed(); } }, false)}
                  <div className="tlx-chips">
                    <span className="tlx-chip">{sp.kind}</span>
                    {sp.theme && <span className="tlx-chip hash">#{sp.theme}</span>}
                    {sp.published && <span className="tlx-chip linear">published</span>}
                    {sp.notes && <span className="tlx-chip" title={sp.notes}>notes</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Fullscreen>
      )}

      {picked && (
        <DetailCard sel={picked.sel} m={m} at={picked} onClose={closeCard}>
          <div className="tlx-actions">
            {picked.sel.kind === "task" && (() => {
              const t = picked.sel.task;
              return (
                <>
                  <button onClick={() => { const i = itemOf(t); if (i) { setEditTask(i); setPicked(null); } }}>edit</button>
                  <button onClick={async () => { await (t.done ? api.reopenItem(numId(t.id)) : api.closeItem(numId(t.id))); await changed(); }}>{t.done ? "reopen" : "done"}</button>
                  {t.date < m.today && !t.done && <button onClick={() => void rollToToday(t)}>→ today</button>}
                  <button onClick={async () => { await api.updateItem(numId(t.id), { due_date: null }); await changed(); }} title="clear due date">unpin</button>
                  <select value={t.laneId ?? ""} onChange={(e) => void setLane(t, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">no lane</option>
                    {m.lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </>
              );
            })()}
            {picked.sel.kind === "span" && (() => {
              const sp = picked.sel.span;
              return <button onClick={() => { setEditSpan(toDraft(sp)); setPicked(null); }}>edit</button>;
            })()}
          </div>
        </DetailCard>
      )}
      {lanePop && (
        <LanePopover lane={lanePop.lane} at={lanePop} spanCount={lanePop.lane ? entries.filter((e) => e.lane_id === lanePop.lane!.id).length : 0}
          onClose={() => setLanePop(null)} onSaved={async () => { setLanePop(null); await loadRoadmap(); }} />
      )}
      {toast && (
        <div className="tl-toast" role="status">
          <span>{toast.label}</span>
          {toast.action && <button onClick={() => { const a = toast.action!; setToast(null); void a.run(); }}>{toast.action.text}</button>}
          <button className="tlx-x" onClick={() => setToast(null)} aria-label="dismiss">×</button>
        </div>
      )}
      {editTask && <TaskDetailModal item={editTask} onChange={() => void changed()} onClose={() => setEditTask(null)} />}
      {editSpan && (
        <SpanEditor draft={editSpan} lanes={lanes} onClose={() => setEditSpan(null)}
          onSaved={async (saved) => {
            const wasPublished = editSpan.published;
            setEditSpan(null);
            await changed();
            // a published entry changed (or lost its flag): the company calendar is now stale
            if (saved.published || wasPublished) showToast({ label: "company calendar may be out of date", action: { text: "sync", run: syncPublished } }, 12000);
          }} />
      )}
    </div>
  );
}
