import { useEffect, useState } from "react";
import type { CalendarEvent } from "@life-console/shared";
import { api } from "../api.js";
import { dayDropProps } from "../dnd.js";

interface Props {
  date: string;
  hourStart?: number;
  hourEnd?: number;
  variant?: "widget" | "column";
  onDropTask?: (itemId: number, date: string) => void;
}

function nowHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function parseTime(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}

export function DailyCalendar({
  date,
  hourStart = 7,
  hourEnd = 22,
  variant = "widget",
  onDropTask,
}: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState({ title: "", start_time: "", end_time: "" });

  const load = () => api.events(date).then(setEvents).catch(() => {});
  useEffect(() => {
    load();
  }, [date]);

  const totalHours = hourEnd - hourStart;
  const hourPx = variant === "column" ? 44 : 28;
  const trackHeight = totalHours * hourPx;
  const today = date === new Date().toISOString().slice(0, 10);
  const nowY = today ? (nowHour() - hourStart) * hourPx : null;

  const submit = async () => {
    if (!draft.title.trim()) return;
    await api.addEvent({
      date,
      title: draft.title.trim(),
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
    });
    setDraft({ title: "", start_time: "", end_time: "" });
    setDrafting(false);
    load();
  };

  return (
    <div
      className={`daycal daycal-${variant}`}
      {...(onDropTask ? dayDropProps(date, onDropTask) : {})}
    >
      <div className="daycal-track" style={{ height: trackHeight }}>
        {Array.from({ length: totalHours + 1 }).map((_, i) => (
          <div
            key={i}
            className="daycal-hour"
            style={{ top: i * hourPx, height: hourPx }}
          >
            <span className="daycal-hour-label">
              {String(hourStart + i).padStart(2, "0")}
            </span>
          </div>
        ))}

        {events.map((e) => {
          const s = parseTime(e.start_time);
          const en = parseTime(e.end_time);
          const isAllDay = s === null;
          const top = isAllDay ? 0 : Math.max(0, (s - hourStart) * hourPx);
          const bottom = en != null ? (en - hourStart) * hourPx : top + hourPx * 0.75;
          const height = Math.max(20, bottom - top);
          const synced = e.source !== "manual";
          return (
            <div
              key={e.id}
              className={`daycal-event ${isAllDay ? "allday" : ""} ${synced ? "synced" : ""}`}
              style={{ top, height: isAllDay ? "auto" : height }}
              onDoubleClick={async () => {
                if (synced) {
                  if (e.deeplink) window.open(e.deeplink, "_blank");
                  return;
                }
                await api.deleteEvent(e.id);
                load();
              }}
              title={synced ? `synced from ${e.source}` : "double-click to delete"}
            >
              <span className="daycal-event-title">{e.title}</span>
              {!isAllDay && (
                <span className="daycal-event-time">
                  {e.start_time}
                  {e.end_time ? `–${e.end_time}` : ""}
                </span>
              )}
            </div>
          );
        })}

        {nowY !== null && nowY >= 0 && nowY <= trackHeight && (
          <div className="daycal-now" style={{ top: nowY }}>
            <span className="daycal-now-label">now</span>
          </div>
        )}
      </div>

      {drafting ? (
        <div className="daycal-draft">
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
      ) : (
        <button className="daycal-add" onClick={() => setDrafting(true)}>
          + event
        </button>
      )}
    </div>
  );
}
