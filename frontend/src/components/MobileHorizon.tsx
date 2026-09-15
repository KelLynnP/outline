// Phone "horizon": a short read-only timeline strip on top and the list of
// what's in that window underneath. Zoom is the main control — it sets the
// strip window AND what the list covers / how it groups (days → weeks →
// months). Unscheduled tasks live at the bottom with a one-tap date picker.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaughtItem, LineView, RoadmapEntry, RoadmapLane, Settings } from "@life-console/shared";
import { api } from "../api.js";
import { useToggle } from "../useToggle.js";
import { TaskComposer, TaskDetailModal } from "./Tasks.js";
import { Board, SpanEditor, Toggle, usePersisted, type Draft } from "./Timeline.js";
import {
  Chips, DetailBody, addDays, dayDiff, dueWord, fmt, fromApi, laneColor, parse, spansOverlapping,
  type Model, type Pick, type Selected, type Span, type Task,
} from "./timelines/shared.js";
import "../timelines.css";

interface Props { line: LineView; items: CaughtItem[]; settings: Settings; onChange: () => void }

// zoom presets: strip window in days · how the list groups
const ZOOMS = [
  { key: "week", days: 10, group: "day" },
  { key: "2 wk", days: 21, group: "day" },
  { key: "month", days: 42, group: "week" },
  { key: "quarter", days: 120, group: "month" },
] as const;

type Row = { date: string; task?: Task; span?: Span; edge?: "start" | "end" };
type Group = { key: string; label: string; sub?: string; rows: Row[]; today: boolean };

const numId = (id: string) => Number(id.slice(1));
const weekStart = (d: string) => addDays(d, -((parse(d).getDay() + 6) % 7));
const monthKey = (d: string) => d.slice(0, 7);

export function MobileHorizon({ line, items, settings, onChange }: Props) {
  const [lanes, setLanes] = useState<RoadmapLane[]>([]);
  const [entries, setEntries] = useState<RoadmapEntry[]>([]);
  const loadRoadmap = useCallback(async () => {
    const [l, e] = await Promise.all([api.roadmapLanes(), api.roadmapEntries(addDays(line.today, -1500), addDays(line.today, 1500))]);
    setLanes(l);
    setEntries(e);
  }, [line.today]);
  useEffect(() => { loadRoadmap().catch(console.error); }, [loadRoadmap]);

  const [zi, setZi] = usePersisted<number>("mh.zoom", 0);
  const [offset, setOffset] = useState(0);
  const [showDone, toggleDone] = useToggle("tl.done", false);
  const [hiddenLanes, setHiddenLanes] = usePersisted<number[]>("tl.hiddenLanes", []);
  const [labels, setLabels] = usePersisted<boolean>("mh.labels", true);
  const [hiddenTasks, setHiddenTasks] = usePersisted<number[]>("mh.hiddenTasks", []); // hidden from the strip only
  const [selected, setSelected] = useState(line.today);
  const [detail, setDetail] = useState<Selected | null>(null); // bottom sheet: look first, edit second
  const [editTask, setEditTask] = useState<CaughtItem | null>(null);
  const [editSpan, setEditSpan] = useState<Draft | null>(null);
  const [composing, setComposing] = useState(false);
  const [unschedOpen, setUnschedOpen] = useState(false);
  const [dating, setDating] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const zoom = ZOOMS[Math.min(zi, ZOOMS.length - 1)];
  const keyOf = (d: string) => (zoom.group === "day" ? d : zoom.group === "week" ? weekStart(d) : monthKey(d));
  const todayKey = keyOf(line.today);
  const days = zoom.days;
  const back = Math.round(days * 0.3);
  const from = addDays(line.today, offset - back);
  const to = addDays(from, days - 1);

  const m = useMemo(() => fromApi(line, lanes, entries, items), [line, lanes, entries, items]);
  const mf: Model = useMemo(() => ({
    ...m,
    spans: m.spans.filter((s) => !hiddenLanes.includes(s.laneId)),
    tasks: m.tasks.filter((t) => (showDone || !t.done) && (t.laneId === null || !hiddenLanes.includes(t.laneId))),
  }), [m, showDone, hiddenLanes]);
  const strip: Model = useMemo(() => ({ ...mf, tasks: mf.tasks.filter((t) => !hiddenTasks.includes(numId(t.id))) }), [mf, hiddenTasks]);
  const toggleHidden = (id: number) => setHiddenTasks((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const changed = async () => { onChange(); await loadRoadmap(); };
  const itemOf = (t: Task) => items.find((i) => i.id === numId(t.id)) ?? null;
  const toDraft = (sp: Span): Draft => ({ ...entries.find((x) => x.id === numId(sp.id))! });
  const newDraft = (kind: Draft["kind"]): Draft => ({
    lane_id: lanes[0]?.id ?? 0, title: "", kind, start_date: selected,
    end_date: kind === "span" ? addDays(selected, 6) : null,
    notes: null, theme: null, color: laneColor(m, lanes[0]?.id ?? null), row_position: null,
    transparent: false, opacity: 1, published: false,
  });
  const pick: Pick = useCallback((sel) => { if (sel.kind !== "station") setDetail(sel); }, []);
  const flipDone = async (t: Task) => { await (t.done ? api.reopenItem(numId(t.id)) : api.closeItem(numId(t.id))); await changed(); };
  const rollToToday = async (t: Task) => { await api.updateItem(numId(t.id), { due_date: line.today }); setDetail(null); await changed(); };
  // keep the sheet's copy fresh after edits; drop it if the thing went away
  useEffect(() => {
    if (!detail) return;
    if (detail.kind === "task") { const t = m.tasks.find((x) => x.id === detail.task.id); setDetail(t ? { kind: "task", task: t } : null); }
    else if (detail.kind === "span") { const sp = m.spans.find((x) => x.id === detail.span.id); setDetail(sp ? { kind: "span", span: sp } : null); }
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- list: everything in the strip window, grouped by the zoom's unit ----
  const groups = useMemo<Group[]>(() => {
    const rows: Row[] = [];
    for (const t of mf.tasks) if (t.date >= from && t.date <= to) rows.push({ date: t.date, task: t });
    for (const sp of spansOverlapping(mf, from, to)) {
      if (sp.kind === "milestone") { if (sp.start >= from && sp.start <= to) rows.push({ date: sp.start, span: sp }); continue; }
      if (sp.start >= from && sp.start <= to) rows.push({ date: sp.start, span: sp, edge: "start" });
      if (sp.end >= from && sp.end <= to && sp.end !== sp.start) rows.push({ date: sp.end, span: sp, edge: "end" });
    }
    const order = (r: Row) => (r.task ? (r.task.done ? 3 : 0) : r.edge === "end" ? 1 : 2);
    rows.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));

    const labelOf = (k: string): [string, string?] => {
      if (zoom.group === "day") {
        const n = dayDiff(line.today, k);
        return [n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : fmt(k, { weekday: "short", month: "short", day: "numeric" }), n === 0 || Math.abs(n) === 1 ? fmt(k, { weekday: "short", month: "short", day: "numeric" }) : undefined];
      }
      if (zoom.group === "week") {
        const isThis = weekStart(line.today) === k;
        return [isThis ? "This week" : `Week of ${fmt(k)}`, `${fmt(k)} – ${fmt(addDays(k, 6))}`];
      }
      return [parse(k + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })];
    };
    const byKey = new Map<string, Row[]>();
    for (const r of rows) { const k = keyOf(r.date); byKey.set(k, [...(byKey.get(k) ?? []), r]); }
    // day grouping: only days that have something (gaps collapse in the render)
    // week/month grouping: every unit in the window, so empty stretches read as such
    const keys = zoom.group === "day"
      ? [...byKey.keys()].sort()
      : (() => {
          const ks: string[] = [];
          for (let d = from; d <= to; d = addDays(d, 1)) { const k = keyOf(d); if (ks[ks.length - 1] !== k) ks.push(k); }
          return ks;
        })();
    if (zoom.group === "day" && !byKey.has(line.today) && line.today >= from && line.today <= to) keys.push(line.today);
    keys.sort();
    return keys.map((k) => {
      const [label, sub] = labelOf(k);
      return { key: k, label, sub, rows: byKey.get(k) ?? [], today: todayKey === k };
    });
  }, [mf, from, to, zoom.group, line.today]); // eslint-disable-line react-hooks/exhaustive-deps

  const unscheduled = items.filter((i) => i.kind === "task" && i.status === "open" && !i.due_date && !i.parent_id);

  const scrollTo = (d: string) => {
    const k = keyOf(d);
    const target = headerRefs.current[k] ?? headerRefs.current[groups.find((g) => g.key >= k)?.key ?? ""];
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  useEffect(() => { scrollTo(line.today); }, [zi]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = async (id: number, date: string) => { await api.updateItem(id, { due_date: date }); setDating(null); await changed(); };
  const nextMonday = addDays(line.today, ((8 - parse(line.today).getDay()) % 7) || 7);

  const taskRow = (t: Task, showDate: boolean) => {
    const hidden = hiddenTasks.includes(numId(t.id));
    return (
      <div key={t.id} className={`mh-row ${t.done ? "done" : ""} ${t.date < line.today && !t.done ? "overdue" : ""} ${hidden ? "hidden" : ""}`} style={{ borderLeftColor: laneColor(m, t.laneId) }}>
        <input type="checkbox" checked={t.done} onChange={() => void flipDone(t)} />
        <button className="mh-title" onClick={() => setDetail({ kind: "task", task: t })}>
          {t.title}
          <span className="mh-sub">{showDate ? `${fmt(t.date, { weekday: "short", day: "numeric" })} · ` : ""}{dueWord(line.today, t.date)}{hidden ? " · off strip" : ""}</span>
        </button>
        {t.date < line.today && !t.done ? (
          <button className="tl-roll" onClick={() => void rollToToday(t)} title="move to today">→ today</button>
        ) : (
          <Chips task={t} />
        )}
        <button className="mh-eye" onClick={() => toggleHidden(numId(t.id))} title={hidden ? "show on the strip" : "hide from the strip"} aria-pressed={!hidden}>
          {hidden ? "◌" : "◉"}
        </button>
      </div>
    );
  };
  const spanRow = (r: Row, showDate: boolean) => {
    const sp = r.span!;
    const glyph = sp.kind === "milestone" ? "◇" : r.edge === "start" ? "▷" : "◁";
    const what = sp.kind === "milestone" ? "milestone" : r.edge === "start" ? `starts · ${dayDiff(sp.start, sp.end) + 1}d` : "ends";
    return (
      <button key={`${sp.id}-${r.edge ?? "m"}`} className="mh-row span" style={{ borderLeftColor: sp.color }} onClick={() => setDetail({ kind: "span", span: sp })}>
        <span className="mh-glyph" style={{ color: sp.color }}>{glyph}</span>
        <span className="mh-title">{sp.title}<span className="mh-sub">{showDate ? `${fmt(r.date, { weekday: "short", day: "numeric" })} · ` : ""}{what}</span></span>
      </button>
    );
  };

  return (
    <div className="mh">
      {/* ---- controls: zoom is the headline ---- */}
      <div className="mh-controls">
        <div className="tlx-seg mh-zoom">
          {ZOOMS.map((z, i) => <button key={z.key} className={zi === i ? "active" : ""} onClick={() => setZi(i)}>{z.key}</button>)}
        </div>
        <div className="tlx-nav">
          <button onClick={() => setOffset((o) => o - Math.round(days / 2))}>‹</button>
          <button onClick={() => { setOffset(0); setSelected(line.today); scrollTo(line.today); }}>today</button>
          <button onClick={() => setOffset((o) => o + Math.round(days / 2))}>›</button>
        </div>
      </div>
      <div className="mh-lanes">
        {m.lanes.map((l) => {
          const off = hiddenLanes.includes(l.id);
          return (
            <button key={l.id} className={`tl-lane-chip ${off ? "off" : ""}`} style={{ color: l.color }}
              onClick={() => setHiddenLanes((h) => (off ? h.filter((x) => x !== l.id) : [...h, l.id]))}>
              <i style={{ background: off ? "transparent" : l.color, borderColor: l.color }} />{l.name}
            </button>
          );
        })}
        <Toggle on={showDone} toggle={toggleDone} label="done" />
        <Toggle on={labels} toggle={() => setLabels((l) => !l)} label="labels" />
        <span className="tlx-hint mh-range">{fmt(from)} → {fmt(to, { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>

      {/* ---- strip ---- */}
      <div className="mh-strip">
        <Board m={strip} full={false} byLane={false} labels={labels} days={days} back={back} offset={offset} selectedDate={selected}
          pick={pick} onPickDay={(d) => { setSelected(d); scrollTo(d); }} onMove={() => {}} onPan={(d) => setOffset((o) => o + d)}
          onZoom={(dir) => setZi((i) => Math.max(0, Math.min(ZOOMS.length - 1, i - dir)))} readOnly />
      </div>

      {/* ---- list ---- */}
      <div className="mh-list" ref={listRef}>
        {groups.length === 0 && <div className="tlx-hint mh-empty">nothing in this window</div>}
        {groups.map((g, i) => {
          const prev = groups[i - 1];
          const gap = zoom.group === "day" && prev ? dayDiff(prev.key, g.key) - 1 : 0;
          const showDate = zoom.group !== "day";
          return (
            <div key={g.key} className={`mh-group ${g.today ? "today" : ""} ${g.key < todayKey ? "past" : ""}`}>
              {gap > 0 && <div className="mh-gap">≈ {gap} quiet {gap === 1 ? "day" : "days"}</div>}
              <div className="mh-head" ref={(el) => { headerRefs.current[g.key] = el; }}>
                <span>{g.label}</span>{g.sub && <small>{g.sub}</small>}
                {g.today && <b>now</b>}
              </div>
              {g.rows.length === 0 && <div className="mh-none">—</div>}
              {g.rows.map((r) => (r.task ? taskRow(r.task, showDate) : spanRow(r, showDate)))}
            </div>
          );
        })}

        {/* ---- unscheduled: at the bottom, collapsed ---- */}
        <div className="mh-group mh-unsched">
          <button className="mh-head mh-unsched-head" onClick={() => setUnschedOpen((o) => !o)}>
            <span>{unschedOpen ? "▾" : "▸"} unscheduled</span><small>{unscheduled.length} task{unscheduled.length === 1 ? "" : "s"} without a date</small>
          </button>
          {unschedOpen && unscheduled.map((i) => (
            <div key={i.id} className="mh-row unsched">
              <button className="mh-title" onClick={() => setEditTask(i)}>{i.text}</button>
              {dating === i.id ? (
                <div className="mh-dates">
                  <button onClick={() => void schedule(i.id, line.today)}>today</button>
                  <button onClick={() => void schedule(i.id, addDays(line.today, 1))}>tmrw</button>
                  <button onClick={() => void schedule(i.id, nextMonday)}>mon</button>
                  <input type="date" onChange={(e) => e.target.value && void schedule(i.id, e.target.value)} />
                  <button onClick={() => setDating(null)}>×</button>
                </div>
              ) : (
                <button className="tlx-chip mh-date-chip" onClick={() => setDating(i.id)}>schedule ▾</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---- add bar ---- */}
      <div className="mh-add">
        <button onClick={() => setComposing((c) => !c)}>{composing ? "× close" : "+ task"}</button>
        <button onClick={() => setEditSpan(newDraft("span"))}>+ span</button>
        <button onClick={() => setEditSpan(newDraft("milestone"))}>+ ◇</button>
        <span className="tlx-hint">{fmt(selected, { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      {composing && (
        <div className="mh-sheet">
          <TaskComposer settings={settings} compact onCreated={() => { setComposing(false); void changed(); }} />
        </div>
      )}

      {detail && !editTask && !editSpan && (
        <div className="mh-detail-overlay" onClick={() => setDetail(null)}>
          <div className="mh-detail" role="dialog" onClick={(e) => e.stopPropagation()}>
            <button className="tlx-x" onClick={() => setDetail(null)} aria-label="close">×</button>
            <DetailBody sel={detail} m={m} />
            <div className="tlx-actions">
              {detail.kind === "task" && (() => {
                const t = detail.task;
                const hidden = hiddenTasks.includes(numId(t.id));
                return (
                  <>
                    <button onClick={() => { const i = itemOf(t); if (i) setEditTask(i); }}>edit</button>
                    <button onClick={() => void flipDone(t)}>{t.done ? "reopen" : "done"}</button>
                    {t.date < line.today && !t.done && <button onClick={() => void rollToToday(t)}>→ today</button>}
                    <button onClick={() => toggleHidden(numId(t.id))}>{hidden ? "◉ show on strip" : "◌ hide from strip"}</button>
                  </>
                );
              })()}
              {detail.kind === "span" && <button onClick={() => setEditSpan(toDraft(detail.span))}>edit</button>}
            </div>
          </div>
        </div>
      )}
      {editTask && <TaskDetailModal item={editTask} onChange={() => void changed()} onClose={() => setEditTask(null)} />}
      {editSpan && <SpanEditor draft={editSpan} lanes={lanes} onClose={() => setEditSpan(null)} onSaved={async () => { setEditSpan(null); await changed(); }} />}
    </div>
  );
}
