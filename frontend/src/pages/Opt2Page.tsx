import { useCallback, useEffect, useState } from "react";
import type { BodySignal, CaughtItem, Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";
import { DailyCalendar } from "../components/DailyCalendar.js";
import { TaskMeta } from "../components/Tasks.js";

// Opt 2 leans hard into "Google Keep + tracking":
//   - one big quick-capture box at the top (task OR log OR event via prefix)
//   - masonry-ish grid of active task cards (colored by priority)
//   - daily calendar as a side column
//   - a running tap-log feed for body signals with big buttons
//   - no direction sentence, minimal chrome, high-signal
export function Opt2Page() {
  const [today, setToday] = useState<TodayView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<CaughtItem[]>([]);
  const [capture, setCapture] = useState("");

  const load = useCallback(async () => {
    const [t, s, i] = await Promise.all([api.today(), api.settings(), api.allItems()]);
    setToday(t);
    setSettings(s);
    setItems(i);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  if (!today || !settings) return <div className="quiet">loading…</div>;

  const active = items
    .filter((i) => i.status !== "closed")
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      return b.captured_date.localeCompare(a.captured_date);
    });

  const submitCapture = async () => {
    const text = capture.trim();
    if (!text) return;

    // Quick-syntax cheats:
    //   "log meal"   → body signal
    //   "log ride"   → body signal
    //   "log ocean"  → body signal
    //   "! ..."      → urgent task
    //   "? ..."      → question task
    //   "@YYYY-MM-DD ..." → due date
    const logMatch = text.match(/^log\s+(meal|bike|ride|ocean|sleep)\b(.*)$/i);
    if (logMatch) {
      const raw = logMatch[1].toLowerCase();
      const type = raw === "ride" ? "bike" : (raw as BodySignal["type"]);
      const note = logMatch[2].trim() || null;
      await api.logSignal({ type, note: note ?? undefined });
      setCapture("");
      load();
      return;
    }

    let rest = text;
    let tag = settings.tags.normal;
    if (rest.startsWith("!")) {
      tag = settings.tags.urgent;
      rest = rest.slice(1).trim();
    } else if (rest.startsWith("?")) {
      tag = settings.tags.question;
      rest = rest.slice(1).trim();
    }
    let due: string | null = null;
    const dateMatch = rest.match(/@(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      due = dateMatch[1];
      rest = rest.replace(dateMatch[0], "").trim();
    }
    const inlineTags: string[] = [];
    rest = rest
      .replace(/#(\w+)/g, (_, t) => {
        inlineTags.push(t);
        return "";
      })
      .trim();
    const priority: 1 | 2 | 3 = tag === settings.tags.urgent ? 1 : 2;
    await api.addItem({ text: rest, tag, due_date: due, priority, tags: inlineTags });
    setCapture("");
    load();
  };

  return (
    <div className="opt2">
      <div className="capture">
        <input
          autoFocus
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitCapture()}
          placeholder="quick capture — task, ! urgent, ? maybe, @2026-08-01 due, #tag, or 'log meal'"
        />
        <button className="primary" onClick={submitCapture}>
          save
        </button>
      </div>
      <div className="capture-hints">
        <kbd>!</kbd> urgent · <kbd>?</kbd> maybe · <kbd>@date</kbd> due · <kbd>#tag</kbd> · <kbd>log meal</kbd>
      </div>

      <div className="opt2-grid">
        <div className="opt2-tasks">
          <div className="opt2-section-head">
            <span>tasks</span>
            <span className="quiet">{active.length} open</span>
          </div>
          <div className="task-cards">
            {active.map((it) => (
              <TaskCard key={it.id} item={it} onChange={load} />
            ))}
            {active.length === 0 && (
              <div className="quiet card-empty">nothing to hold. quiet moment.</div>
            )}
          </div>
        </div>

        <div className="opt2-side">
          <div className="opt2-section-head">
            <span>today</span>
            <span className="quiet">
              {new Date(today.date + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <DailyCalendar date={today.date} variant="column" />

          <div className="opt2-section-head" style={{ marginTop: 32 }}>
            <span>track</span>
            <span className="quiet">
              {today.body.hours_since_meal !== null
                ? `${Math.round(today.body.hours_since_meal)}h since eating`
                : "no meals logged"}
            </span>
          </div>
          <div className="track-buttons">
            {settings.body.tracked.meals && (
              <TapButton
                label="meal"
                onTap={async () => { await api.logSignal({ type: "meal" }); load(); }}
                alert={today.body.meal_alert}
              />
            )}
            {settings.body.tracked.bike && (
              <TapButton
                label="ride"
                onTap={async () => { await api.logSignal({ type: "bike" }); load(); }}
              />
            )}
            {settings.body.tracked.ocean && (
              <TapButton
                label="ocean"
                onTap={async () => { await api.logSignal({ type: "ocean" }); load(); }}
              />
            )}
            {settings.body.tracked.sleep && (
              <TapButton
                label="sleep"
                onTap={async () => {
                  const hrs = prompt("hours slept?");
                  if (!hrs) return;
                  await api.logSignal({ type: "sleep", note: hrs });
                  load();
                }}
              />
            )}
          </div>
          <ul className="track-feed">
            {today.body.signals.slice(0, 10).map((s) => (
              <li key={s.id}>
                <span className="dot" />
                <span className="type">{s.type}</span>
                <span className="time quiet">
                  {timeAgo(s.timestamp)}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
              </li>
            ))}
            {today.body.signals.length === 0 && (
              <li className="quiet">no signals yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function TaskCard({
  item,
  onChange,
}: {
  item: CaughtItem;
  onChange: () => void;
}) {
  const overdue =
    item.due_date && new Date(item.due_date) < new Date();
  return (
    <div className={`task-card prio-bg-${item.priority} ${overdue ? "overdue" : ""}`}>
      <div className="task-card-text">{item.text}</div>
      <TaskMeta item={item} />
      <div className="task-card-actions">
        <button
          onClick={async () => {
            await api.closeItem(item.id);
            onChange();
          }}
        >
          done
        </button>
        {item.status !== "carried" && (
          <button
            onClick={async () => {
              await api.carryItem(item.id);
              onChange();
            }}
          >
            carry
          </button>
        )}
      </div>
    </div>
  );
}

function TapButton({
  label,
  onTap,
  alert,
}: {
  label: string;
  onTap: () => void;
  alert?: boolean;
}) {
  return (
    <button className={`tap ${alert ? "tap-alert" : ""}`} onClick={onTap}>
      <span className="tap-label">{label}</span>
      <span className="tap-hint">tap to log</span>
    </button>
  );
}
