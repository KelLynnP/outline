import { useEffect, useMemo, useRef, useState } from "react";
import { localDateISO, type CalendarEvent } from "@life-console/shared";
import { api } from "../api.js";
import {
  EVENT_MIME,
  TASK_MIME as MIME,
  dragDurationMin,
  eventDragProps,
  taskDragProps,
} from "../dnd.js";
import { EVENT_HUES, hueColors, tagColors } from "../colors.js";
import { fmt12, h12 } from "../time.js";
import { useToggle } from "../useToggle.js";

interface Props {
  date: string;
  hourStart?: number;
  hourEnd?: number;
  variant?: "widget" | "column";
  onDropTaskAtTime?: (
    itemId: number,
    date: string,
    startHM: string,
    durationMin?: number,
  ) => void | Promise<void>;
  /** Called after a task item is changed from the detail panel (done / unschedule). */
  onTaskChange?: () => void | Promise<void>;
  /** Change to force an event refetch (page-level actions can move events). */
  refreshKey?: unknown;
}

function parseTime(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toHM(hour: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.round((hour - h) * 60);
  const mm = m >= 30 ? 30 : 0;
  return `${pad(h)}:${pad(mm)}`;
}
/** Exact HH:MM (15-min resolution), used by resize. */
function hmExact(hour: number): string {
  const total = Math.round(hour * 4) * 15;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}
function nowHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

type LaidOut = CalendarEvent & {
  startH: number;
  endH: number;
  col: number;
  cols: number;
};

function layoutTimed(events: CalendarEvent[]): LaidOut[] {
  const timed = events
    .map((e) => {
      const startH = parseTime(e.start_time);
      if (startH === null) return null;
      const endH = parseTime(e.end_time) ?? startH + 1;
      return { ...e, startH, endH, col: 0, cols: 1 };
    })
    .filter((e): e is LaidOut => e !== null)
    .sort((a, b) => a.startH - b.startH || b.endH - a.endH);

  const groups: LaidOut[][] = [];
  let cur: LaidOut[] = [];
  let curEnd = -1;
  for (const e of timed) {
    if (cur.length === 0 || e.startH < curEnd) {
      cur.push(e);
      curEnd = Math.max(curEnd, e.endH);
    } else {
      groups.push(cur);
      cur = [e];
      curEnd = e.endH;
    }
  }
  if (cur.length) groups.push(cur);

  for (const group of groups) {
    const colEnds: number[] = [];
    for (const e of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= e.startH) {
          e.col = c;
          colEnds[c] = e.endH;
          placed = true;
          break;
        }
      }
      if (!placed) {
        e.col = colEnds.length;
        colEnds.push(e.endH);
      }
    }
    const cols = colEnds.length;
    for (const e of group) e.cols = cols;
  }
  return timed;
}

/** Pick a size tier from the rendered block height so text always fits. */
function sizeForHeight(px: number): "xs" | "sm" | "md" | "lg" {
  if (px < 18) return "xs";
  if (px < 30) return "sm";
  if (px < 48) return "md";
  return "lg";
}

const ZOOM_KEY = "daycal.hourPx";

export function DailyCalendar({
  date,
  hourStart = 0,
  hourEnd = 24,
  variant = "widget",
  onDropTaskAtTime,
  onTaskChange,
  refreshKey,
}: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState({ title: "", start_time: "", end_time: "" });
  const [ghost, setGhost] = useState<{ hour: number; durMin: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resizing, setResizing] = useState<{ id: number; startH: number; endH: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<typeof resizing>(null);
  const deleteTimer = useRef<number | null>(null);
  // Latest load, so delayed callbacks (undo timer) never fetch a stale date.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  // Vertical zoom (px per hour), persisted across sessions.
  const [hourPx, setHourPx] = useState(() => {
    const stored = Number(localStorage.getItem(ZOOM_KEY));
    return stored >= 32 && stored <= 96 ? stored : variant === "column" ? 60 : 56;
  });
  const pendingCenter = useRef<number | null>(null);
  const zoom = (delta: number) => {
    const el = scrollRef.current;
    if (el) pendingCenter.current = hourStart + (el.scrollTop + el.clientHeight / 2) / hourPx;
    const next = Math.min(96, Math.max(32, hourPx + delta));
    setHourPx(next);
    localStorage.setItem(ZOOM_KEY, String(next));
  };
  // Keep the same time centered when zooming.
  useEffect(() => {
    const el = scrollRef.current;
    const c = pendingCenter.current;
    pendingCenter.current = null;
    if (el && c !== null) {
      el.scrollTop = (c - hourStart) * hourPx - el.clientHeight / 2;
    }
  }, [hourPx]);

  // On open / date change, scroll to the working part of the day
  // (a bit above "now" for today, 8am otherwise).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isToday = date === localDateISO();
    const target = isToday ? Math.max(hourStart, nowHour() - 1.5) : 8;
    el.scrollTop = (target - hourStart) * hourPx;
  }, [date]);

  const load = () =>
    api.events(date).then(setEvents).catch(() => setEvents([]));
  loadRef.current = load;
  useEffect(() => {
    load();
  }, [date, refreshKey]);
  useEffect(() => {
    setSelectedId(null);
  }, [date]);

  // Esc or a click anywhere outside the popup / a block closes the popup.
  const suppressTrackClick = useRef(false);
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSelectedId(null);
    };
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Element;
      if (t.closest(".daycal-detail") || t.closest(".daycal-event")) return;
      if (trackRef.current?.contains(t)) suppressTrackClick.current = true;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [selectedId]);

  // Drag the bottom edge of a task/manual block to change its duration.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (ev: MouseEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const raw = hourStart + (ev.clientY - el.getBoundingClientRect().top) / hourPx;
      const snapped = Math.round(raw * 4) / 4; // 15-min steps
      setResizing((r) => {
        if (!r) return r;
        const next = { ...r, endH: Math.max(r.startH + 0.25, Math.min(hourEnd, snapped)) };
        resizeRef.current = next;
        return next;
      });
    };
    const onUp = async () => {
      const r = resizeRef.current;
      resizeRef.current = null;
      setResizing(null);
      // The mouseup also produces a click on the track; don't open a draft.
      suppressTrackClick.current = true;
      if (r) {
        await api.setEventTimes(r.id, hmExact(r.startH), hmExact(r.endH));
        await load();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing !== null]);

  // Decline/remove is soft: hide the event, show an undo toast, commit after 6s.
  const requestDelete = (e: CalendarEvent) => {
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    if (pendingDelete) void api.deleteEvent(pendingDelete.id);
    setPendingDelete(e);
    deleteTimer.current = window.setTimeout(async () => {
      deleteTimer.current = null;
      await api.deleteEvent(e.id);
      setPendingDelete(null);
      await loadRef.current();
    }, 6000);
  };
  const undoDelete = () => {
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    setPendingDelete(null);
  };

  const totalHours = hourEnd - hourStart;
  const trackHeight = totalHours * hourPx;
  const today = date === localDateISO();
  const nowY = today ? (nowHour() - hourStart) * hourPx : null;

  // Visibility toggles (persisted).
  const [showTasks, toggleTasks] = useToggle("daycal.showTasks", true);
  const [showDeclined, toggleDeclined] = useToggle("daycal.showDeclined", false);

  const selfDeclined = (e: CalendarEvent) =>
    (e.source === "calendar" || e.source === "google") &&
    e.attendees?.find((a) => a.self)?.status === "declined";

  // Hide events awaiting undo-able deletion or filtered out by a toggle.
  const visible = useMemo(
    () =>
      events.filter(
        (e) =>
          e.id !== pendingDelete?.id &&
          (showTasks || e.source !== "task") &&
          (showDeclined || !selfDeclined(e)),
      ),
    [events, pendingDelete, showTasks, showDeclined],
  );
  const allDay = useMemo(
    () => visible.filter((e) => e.start_time == null),
    [visible],
  );
  // Pack meetings + tasks in one column so overlapping items sit side-by-side.
  const timed = useMemo(
    () => layoutTimed(visible.filter((e) => e.start_time != null)),
    [visible],
  );

  const FULL_LANE = { leftPct: 0, widthPct: 100 };

  const selected = events.find((e) => e.id === selectedId) ?? null;
  // Anchor the detail popover just below the selected block, clamped to the track.
  const selectedLaid = timed.find((t) => t.id === selectedId);
  const popTop = selectedLaid
    ? Math.max(4, Math.min((selectedLaid.endH - hourStart) * hourPx + 4, trackHeight - 300))
    : 4;

  // Draft popover sits just below its start time (or the top when opened
  // from the "+ event" button with no time picked yet).
  const draftStartH = parseTime(draft.start_time || null);
  const draftTop =
    draftStartH !== null
      ? Math.max(4, Math.min((draftStartH + 1 - hourStart) * hourPx + 4, trackHeight - 80))
      : 4;

  const submit = async () => {
    if (!draft.title.trim()) return;
    await api.addEvent({
      date,
      title: draft.title.trim(),
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      source: "manual",
    });
    setDraft({ title: "", start_time: "", end_time: "" });
    setDrafting(false);
    load();
  };

  const hourFromClientY = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return hourStart;
    const rect = el.getBoundingClientRect();
    const rel = clientY - rect.top;
    const rawHour = hourStart + rel / hourPx;
    const snapped = Math.round(rawHour * 2) / 2;
    return Math.max(hourStart, Math.min(hourEnd - 1, snapped));
  };

  const endHMFor = (startHM: string, durMin: number) => {
    const [h, m] = startHM.split(":").map(Number);
    const total = h * 60 + m + durMin;
    return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  };

  const trackDropProps = {
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types;
      if (!t.includes(MIME) && !t.includes(EVENT_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setGhost({
        hour: hourFromClientY(e.clientY),
        durMin: dragDurationMin(e.dataTransfer) ?? 60,
      });
    },
    onDragLeave: (e: React.DragEvent) => {
      if (
        e.currentTarget === e.target ||
        !e.currentTarget.contains(e.relatedTarget as Node)
      ) {
        setGhost(null);
      }
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      const hour = hourFromClientY(e.clientY);
      const durMin = dragDurationMin(e.dataTransfer) ?? 60;
      setGhost(null);
      const taskId = Number(e.dataTransfer.getData(MIME));
      const eventId = Number(e.dataTransfer.getData(EVENT_MIME));
      if (taskId && onDropTaskAtTime) {
        await onDropTaskAtTime(taskId, date, toHM(hour), durMin);
      } else if (eventId) {
        const start = toHM(hour);
        await api.setEventTimes(eventId, start, endHMFor(start, durMin));
      } else {
        return;
      }
      await load();
    },
  };

  return (
    <div className={`daycal daycal-${variant}`}>
      <div className="daycal-toolbar">
        <button
          className={`tog ${showTasks ? "on" : ""}`}
          onClick={toggleTasks}
          title="show scheduled tasks"
        >
          tasks
        </button>
        <button
          className={`tog ${showDeclined ? "on" : ""}`}
          onClick={toggleDeclined}
          title="show meetings you declined"
        >
          declined
        </button>
        <span className="daycal-toolbar-gap" />
        <button onClick={() => zoom(-12)} title="compress hours">−</button>
        <button onClick={() => zoom(12)} title="expand hours">+</button>
      </div>

      {allDay.length > 0 && (
        <div className="daycal-allday">
          {allDay.map((e) => (
            <EventBlock
              key={e.id}
              e={e}
              allDay
              selected={selectedId === e.id}
              onSelect={() =>
                setSelectedId((cur) => (cur === e.id ? null : e.id))
              }
            />
          ))}
        </div>
      )}

      <div className="daycal-scroll" ref={scrollRef}>
      <div
        className="daycal-track"
        ref={trackRef}
        style={{ height: trackHeight }}
        {...trackDropProps}
        onMouseDown={() => {
          // A fresh press clears any stale suppression; the document-level
          // close-popup handler (which runs after this) may re-set it.
          suppressTrackClick.current = false;
        }}
        onClick={(ev) => {
          // Click on an empty slot starts a draft at that time.
          if (suppressTrackClick.current) {
            suppressTrackClick.current = false;
            return;
          }
          const hour = hourFromClientY(ev.clientY);
          setDraft((d) => ({
            title: drafting ? d.title : "", // relocating an open draft keeps the text
            start_time: toHM(hour),
            end_time: toHM(Math.min(hourEnd, hour + 1)),
          }));
          setDrafting(true);
        }}
      >
        {Array.from({ length: totalHours + 1 }).map((_, i) => (
          <div
            key={i}
            className="daycal-hour"
            style={{ top: i * hourPx, height: hourPx }}
          >
            <span className="daycal-hour-label">{h12(hourStart + i)}</span>
          </div>
        ))}

        {timed.map((e) => {
          const editable = e.source === "task" || e.source === "manual";
          return (
            <EventBlock
              key={e.id}
              e={e}
              hourStart={hourStart}
              hourPx={hourPx}
              lane={FULL_LANE}
              col={e.col}
              cols={e.cols}
              startH={e.startH}
              endH={resizing?.id === e.id ? resizing.endH : e.endH}
              selected={selectedId === e.id}
              onSelect={() =>
                setSelectedId((cur) => (cur === e.id ? null : e.id))
              }
              onResizeStart={
                editable
                  ? (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const r = { id: e.id, startH: e.startH, endH: e.endH };
                      resizeRef.current = r;
                      setResizing(r);
                    }
                  : undefined
              }
              onQuickDone={
                e.source === "task" && e.item_id
                  ? async () => {
                      await api.closeItem(e.item_id!);
                      await load();
                      await onTaskChange?.();
                    }
                  : undefined
              }
            />
          );
        })}

        {ghost !== null && (
          <div
            className="daycal-ghost"
            style={{
              top: (ghost.hour - hourStart) * hourPx,
              height: (ghost.durMin / 60) * hourPx,
              left: "2px",
              width: "calc(100% - 6px)",
            }}
          >
            <span>
              {fmt12(toHM(ghost.hour))} – {fmt12(toHM(ghost.hour + ghost.durMin / 60))}
            </span>
          </div>
        )}

        {nowY !== null && nowY >= 0 && nowY <= trackHeight && (
          <div className="daycal-now" style={{ top: nowY }}>
            <span className="daycal-now-label">now</span>
          </div>
        )}

        {selected && (
          <EventDetail
            key={selected.id}
            e={selected}
            style={{ top: popTop }}
            onClose={() => setSelectedId(null)}
            onChanged={async () => {
              await load();
            }}
            onTaskChange={onTaskChange}
            onRequestDelete={() => {
              requestDelete(selected);
              setSelectedId(null);
            }}
          />
        )}

        {drafting && (
          <div
            className="daycal-draft"
            style={{ top: draftTop }}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => ev.key === "Escape" && setDrafting(false)}
          >
            <input
              autoFocus
              placeholder="event"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <input
              type="time"
              value={draft.start_time}
              onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
            />
            <input
              type="time"
              value={draft.end_time}
              onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
            />
            <button onClick={submit}>add</button>
            <button onClick={() => setDrafting(false)}>cancel</button>
          </div>
        )}
      </div>
      </div>

      {pendingDelete && (
        <div className="daycal-undo">
          <span>
            removed <strong>{pendingDelete.title}</strong>
          </span>
          <button onClick={undoDelete}>undo</button>
        </div>
      )}

      {!drafting && (
        <button className="daycal-add" onClick={() => setDrafting(true)}>
          + event
        </button>
      )}
    </div>
  );
}

function EventDetail({
  e,
  style,
  onClose,
  onChanged,
  onTaskChange,
  onRequestDelete,
}: {
  e: CalendarEvent;
  style?: React.CSSProperties;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onTaskChange?: () => void | Promise<void>;
  onRequestDelete?: () => void;
}) {
  const isTask = e.source === "task";
  const confirmed = e.status === "confirmed";
  // Google-synced events are read-only; tasks + manual events can be re-timed.
  const editable = isTask || e.source === "manual";
  const [times, setTimes] = useState({
    start: e.start_time ?? "",
    end: e.end_time ?? "",
  });
  const dirty = times.start !== (e.start_time ?? "") || times.end !== (e.end_time ?? "");
  const saveTimes = async () => {
    await api.setEventTimes(e.id, times.start || null, times.end || null);
    await onChanged();
  };
  const timeLabel = e.start_time
    ? `${fmt12(e.start_time)}${e.end_time ? ` – ${fmt12(e.end_time)}` : ""}`
    : "all day";
  const sourceLabel = isTask
    ? "scheduled task"
    : e.source === "calendar" || e.source === "google"
      ? "google calendar"
      : e.source;

  const confirm = async () => {
    await api.setEventStatus(e.id, confirmed ? null : "confirmed");
    await onChanged();
  };
  const reject = async () => {
    if (onRequestDelete) {
      onRequestDelete(); // soft delete with undo, handled by the calendar
      return;
    }
    await api.deleteEvent(e.id);
    await onChanged();
    onClose();
  };
  const doneTask = async () => {
    if (e.item_id) await api.closeItem(e.item_id);
    else await api.deleteEvent(e.id); // closing the item also removes its block
    await onChanged();
    await onTaskChange?.();
    onClose();
  };
  const unschedule = async () => {
    if (e.item_id) await api.unscheduleItem(e.item_id);
    else await api.deleteEvent(e.id);
    await onChanged();
    await onTaskChange?.();
    onClose();
  };

  const attendees = e.attendees ?? [];
  const [showGuests, setShowGuests] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const longDesc = (e.description?.length ?? 0) > 160;

  return (
    <div
      className={`daycal-detail ${isTask ? "task" : ""} ${confirmed ? "confirmed" : ""}`}
      style={style}
      onClick={(ev) => ev.stopPropagation()}
    >
      <div className="daycal-detail-head">
        <div className="daycal-detail-title">{e.title}</div>
        <button className="daycal-detail-close" onClick={onClose} title="close">
          ×
        </button>
      </div>
      <div className="daycal-detail-meta">
        {editable && !e.start_time ? (
          <span className="daycal-detail-times">
            <span className="mono">
              all day{e.end_date ? ` · ${e.date} → ${e.end_date}` : ""}
            </span>
            <span className="quiet">until</span>
            <input
              type="date"
              value={e.end_date ?? ""}
              min={e.date}
              onChange={async (ev) => {
                await api.setEventEndDate(e.id, ev.target.value || null);
                await onChanged();
              }}
            />
          </span>
        ) : editable ? (
          <span className="daycal-detail-times">
            <input
              type="time"
              value={times.start}
              onChange={(ev) => setTimes({ ...times, start: ev.target.value })}
            />
            –
            <input
              type="time"
              value={times.end}
              onChange={(ev) => setTimes({ ...times, end: ev.target.value })}
            />
            {dirty && (
              <button className="times-save" onClick={saveTimes}>
                save
              </button>
            )}
          </span>
        ) : (
          <span className="mono">{timeLabel}</span>
        )}
        <span className="src">{sourceLabel}</span>
        {confirmed && <span className="badge">confirmed</span>}
      </div>
      {e.source === "manual" && (
        <div className="daycal-detail-swatches">
          {EVENT_HUES.map((h) => (
            <button
              key={h}
              className={`swatch ${e.hue === h ? "on" : ""}`}
              style={{ background: hueColors(h).bg, borderColor: hueColors(h).border }}
              title="set color"
              onClick={async () => {
                await api.setEventHue(e.id, e.hue === h ? null : h);
                await onChanged();
              }}
            />
          ))}
        </div>
      )}
      {e.location && (
        <div className="daycal-detail-row">
          <span className="lbl">where</span>
          <span>{e.location}</span>
        </div>
      )}
      {e.description && (
        <div className="daycal-detail-desc">
          {longDesc && !showFullDesc
            ? `${e.description.slice(0, 160)}… `
            : e.description}
          {longDesc && (
            <button
              className="inline-toggle"
              onClick={() => setShowFullDesc((v) => !v)}
            >
              {showFullDesc ? "less" : "more"}
            </button>
          )}
        </div>
      )}
      {attendees.length > 0 && (
        <div className="daycal-detail-guests">
          <button
            className="inline-toggle"
            onClick={() => setShowGuests((v) => !v)}
          >
            {showGuests ? "▾" : "▸"} {attendees.length}{" "}
            {attendees.length === 1 ? "guest" : "guests"}
          </button>
          {showGuests && (
            <ul className="daycal-detail-people">
              {attendees.map((a, i) => {
                const label = a.name || a.email || "guest";
                const status =
                  a.status && a.status !== "needsAction" ? a.status : null;
                return (
                  <li key={`${a.email ?? label}-${i}`}>
                    <span className="who">
                      {label}
                      {a.self ? " (you)" : ""}
                    </span>
                    {status && <span className={`rsvp ${status}`}>{status}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="daycal-detail-actions">
        {isTask ? (
          <>
            <button className="ev-btn-lg" onClick={doneTask}>
              ✓ done
            </button>
            <button className="ev-btn-lg danger" onClick={unschedule}>
              ✗ unschedule
            </button>
          </>
        ) : (
          <>
            <button className={`ev-btn-lg ${confirmed ? "on" : ""}`} onClick={confirm}>
              {confirmed ? "✓ accepted" : "✓ accept"}
            </button>
            <button className="ev-btn-lg danger" onClick={reject}>
              ✗ decline
            </button>
          </>
        )}
        {e.deeplink && (
          <a className="ev-btn-lg link" href={e.deeplink} target="_blank" rel="noreferrer">
            open in calendar →
          </a>
        )}
      </div>
    </div>
  );
}

function EventBlock({
  e,
  hourStart = 7,
  hourPx = 56,
  allDay = false,
  lane = { leftPct: 0, widthPct: 100 },
  col = 0,
  cols = 1,
  startH,
  endH,
  selected = false,
  onSelect,
  onResizeStart,
  onQuickDone,
}: {
  e: CalendarEvent;
  hourStart?: number;
  hourPx?: number;
  allDay?: boolean;
  lane?: { leftPct: number; widthPct: number };
  col?: number;
  cols?: number;
  startH?: number;
  endH?: number;
  selected?: boolean;
  onSelect?: () => void;
  onResizeStart?: (ev: React.MouseEvent) => void;
  onQuickDone?: () => void | Promise<void>;
}) {
  const isTask = e.source === "task";
  const confirmed = e.status === "confirmed";
  const isExternal = e.source === "calendar" || e.source === "google";
  // Your own RSVP on synced meetings, surfaced as a block style.
  const selfStatus = isExternal
    ? (e.attendees?.find((a) => a.self)?.status ?? null)
    : null;
  const rsvpClass =
    selfStatus === "needsAction" && !confirmed
      ? "rsvp-needsaction"
      : selfStatus === "tentative"
        ? "rsvp-tentative"
        : selfStatus === "declined"
          ? "rsvp-declined"
          : "";

  let style: React.CSSProperties | undefined;
  let size: "xs" | "sm" | "md" | "lg" = "md";
  let height = 40;

  if (!allDay && startH != null && endH != null) {
    const top = Math.max(0, (startH - hourStart) * hourPx);
    height = Math.max(12, (endH - startH) * hourPx - 1);
    size = sizeForHeight(height);
    const gap = 1;
    const colWidth = lane.widthPct / cols;
    const left = lane.leftPct + col * colWidth;
    style = {
      top,
      height,
      left: `calc(${left}% + ${gap}px)`,
      width: `calc(${colWidth}% - ${gap * 2}px)`,
      right: "auto",
      // scale title font to the block so a 15-min slot never clips mid-glyph
      ["--ev-fs" as string]:
        size === "xs" ? "9px" : size === "sm" ? "10px" : size === "md" ? "11px" : "12px",
      ["--ev-lh" as string]: size === "xs" || size === "sm" ? "1.05" : "1.2",
    };
  }

  const cls = [
    "daycal-event",
    `size-${size}`,
    allDay ? "allday" : "",
    isTask ? "task-event" : "",
    confirmed ? "confirmed" : "",
    selected ? "selected" : "",
    isExternal ? "external-event" : "",
    !isTask && !allDay ? "synced" : "",
    rsvpClass,
  ]
    .filter(Boolean)
    .join(" ");

  // xs: title only, no time. sm+: title + time if room.
  const showTime = !allDay && (size === "md" || size === "lg") && !!e.start_time;

  // Scheduled tasks and manual events can be dragged to a new slot; the
  // block's own duration rides along so it survives the move.
  const durMin =
    startH != null && endH != null ? Math.round((endH - startH) * 60) : 0;
  const dragProps = allDay
    ? {}
    : isTask && e.item_id
      ? taskDragProps(e.item_id, durMin)
      : e.source === "manual"
        ? eventDragProps(e.id, durMin)
        : {};

  // Tint: tasks by their tag, manual events by their picked hue.
  const tint =
    isTask && e.item_tag
      ? tagColors(e.item_tag)
      : e.source === "manual" && e.hue != null
        ? hueColors(e.hue)
        : null;
  if (tint) {
    style = {
      ...style,
      background: tint.bg,
      borderColor: tint.border,
      color: tint.ink,
    };
  }

  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      {...dragProps}
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect?.();
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect?.();
        }
      }}
      title="click for details"
    >
      <div className="daycal-event-body">
        <span className="daycal-event-title">{e.title}</span>
        {showTime && (
          <span className="daycal-event-time">
            {fmt12(e.start_time!)}
            {e.end_time ? `–${fmt12(e.end_time)}` : ""}
          </span>
        )}
      </div>
      {onQuickDone && (
        <button
          className="daycal-quick-done"
          title="mark done"
          onClick={(ev) => {
            ev.stopPropagation();
            void onQuickDone();
          }}
        >
          ✓
        </button>
      )}
      {onResizeStart && !allDay && (
        <div
          className="daycal-resize"
          title="drag to change duration"
          draggable={false}
          onMouseDown={onResizeStart}
          onClick={(ev) => ev.stopPropagation()}
          onDragStart={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          }}
        />
      )}
    </div>
  );
}
