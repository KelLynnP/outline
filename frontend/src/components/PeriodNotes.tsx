import { useEffect, useRef, useState } from "react";
import {
  startOfWeekISO,
  type WeekStart,
} from "@life-console/shared";
import { api } from "../api.js";
import { MarkdownNoteEditor } from "./MarkdownNoteEditor.js";

type Scope = "day" | "week" | "month" | "year" | "media";

const SCOPES: Scope[] = ["day", "week", "month", "year", "media"];

const DAY_MS = 86_400_000;

const short = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Note key for a scope anchored at a date. Day = plain date (stops.notes);
 *  week/month/year prefix keys go to period_notes. Media log is a single
 *  timeless note under the fixed key "media-log". */
function keyFor(scope: Scope, date: string, weekStartsOn: WeekStart): string {
  return scope === "day"
    ? date
    : scope === "week"
      ? `week-${startOfWeekISO(date, weekStartsOn)}`
      : scope === "month"
        ? `month-${date.slice(0, 7)}`
        : scope === "year"
          ? `year-${date.slice(0, 4)}`
          : "media-log";
}

const scopeOf = (key: string): Scope =>
  key === "media-log"
    ? "media"
    : key.startsWith("week-")
      ? "week"
      : key.startsWith("month-")
        ? "month"
        : key.startsWith("year-")
          ? "year"
          : "day";

function labelFor(key: string): string {
  switch (scopeOf(key)) {
    case "day":
      return new Date(key + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    case "week": {
      const start = new Date(key.slice(5) + "T00:00:00");
      const end = new Date(start.getTime() + 6 * DAY_MS);
      return `week of ${short(start)} – ${short(end)}`;
    }
    case "month":
      return new Date(key.slice(6) + "-01T00:00:00").toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
    case "year":
      return key.slice(5);
    case "media":
      return "media log";
  }
}

/* Pinned note keys survive reloads; pins hold a specific period in place
 * while the primary pane follows the timeline. */
const PINS_KEY = "notes.pins";
const loadPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
  } catch {
    return [];
  }
};

interface Props {
  date: string;
  view: "day" | "week" | "month";
  weekStartsOn: WeekStart;
}

// Notes panes: one follows the selected day/week/month, plus any pinned
// periods ("+" pins a scope anchored at the selected date — it stays put
// while you navigate). Each period is its own note.
export function PeriodNotes({ date, view, weekStartsOn }: Props) {
  const [pins, setPins] = useState<string[]>(loadPins);
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scope, setScope] = useState<Scope>(view);
  const [dark, setDark] = useState(
    () => localStorage.getItem("notes.dark") === "1",
  );
  const primaryKey = keyFor(scope, date, weekStartsOn);

  useEffect(() => setScope(view), [view]);

  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocused(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focused]);

  const savePins = (next: string[]) => {
    setPins(next);
    localStorage.setItem(PINS_KEY, JSON.stringify(next));
  };
  const addPin = (scope: Scope) => {
    setPicking(false);
    const key = keyFor(scope, date, weekStartsOn);
    if (key !== primaryKey && !pins.includes(key)) savePins([...pins, key]);
  };

  return (
    <div className={`daynotes${focused ? " focused" : ""}${dark ? " dark" : ""}`}>
      <div className="daynotes-controls">
        <div className="daynotes-scopes" aria-label="Note period">
          {SCOPES.map((option) => (
            <button
              key={option}
              type="button"
              className={scope === option ? "active" : ""}
              onClick={() => setScope(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="daynotes-actions">
          <button
            type="button"
            className="row-icon"
            title={dark ? "use light notes" : "use dark notes"}
            onClick={() => {
              setDark((current) => {
                localStorage.setItem("notes.dark", current ? "0" : "1");
                return !current;
              });
            }}
          >
            {dark ? "☀" : "◐"}
          </button>
          <button
            type="button"
            className="row-icon"
            title={focused ? "exit focus mode" : "focus on this note"}
            onClick={() => setFocused((current) => !current)}
          >
            {focused ? "↙" : "↗"}
          </button>
        </div>
      </div>
      <div className="daynotes-panes">
        <NotePane key={primaryKey} noteKey={primaryKey} />
        {pins
          .filter((k) => k !== primaryKey)
          .map((k) => (
            <NotePane
              key={k}
              noteKey={k}
              pinned
              onUnpin={() => savePins(pins.filter((p) => p !== k))}
            />
          ))}
        <div className="daynotes-pin">
          {picking ? (
            SCOPES.map((s) => (
              <button
                key={s}
                className="pin-chip"
                title={`pin the ${s} note for the selected date — stays while you navigate`}
                onClick={() => addPin(s)}
              >
                {s}
              </button>
            ))
          ) : (
            <button
              className="row-icon"
              title="pin another note alongside"
              onClick={() => setPicking(true)}
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NotePane({
  noteKey,
  pinned = false,
  onUnpin,
}: {
  noteKey: string;
  pinned?: boolean;
  onUnpin?: () => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "saving">("idle");
  const dirtyRef = useRef(false);
  const valueRef = useRef("");
  const savingRef = useRef(false);
  const saveTimerRef = useRef<number>();
  const statusTimerRef = useRef<number>();
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    setStatus("idle");
    dirtyRef.current = false;
    api
      .notes(noteKey)
      .then((n) => {
        if (!cancelled) {
          valueRef.current = n.notes;
          setValue(n.notes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          valueRef.current = "";
          setValue("");
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(saveTimerRef.current);
      window.clearTimeout(statusTimerRef.current);
      if (dirtyRef.current) {
        void api.saveNotes(noteKey, valueRef.current).catch(() => {});
      }
    };
  }, [noteKey]);

  const save = async () => {
    if (!dirtyRef.current || savingRef.current) return;
    const savingValue = valueRef.current;
    savingRef.current = true;
    setStatus("saving");
    try {
      await api.saveNotes(noteKey, savingValue);
      if (valueRef.current === savingValue) dirtyRef.current = false;
      setStatus("saved");
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("idle");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && valueRef.current !== savingValue) {
        void saveRef.current();
      }
    }
  };
  saveRef.current = save;

  useEffect(() => {
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void saveRef.current();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => document.removeEventListener("visibilitychange", saveWhenHidden);
  }, []);

  return (
    <div className={`notepane ${pinned ? "pinned" : ""}`}>
      <div className="daynotes-head">
        <span className="daynotes-title">notes · {labelFor(noteKey)}</span>
        <span className="daynotes-head-right">
          <span className={`daynotes-status ${status}`}>
            {status === "saving" ? "saving…" : status === "saved" ? "saved" : ""}
          </span>
          {pinned && (
            <button className="row-icon" title="unpin" onClick={onUnpin}>
              ×
            </button>
          )}
        </span>
      </div>
      {value === null ? (
        <div className="daynotes-loading">loading…</div>
      ) : (
        <MarkdownNoteEditor
          initialValue={value}
          emptyText={
            noteKey === "media-log"
              ? "books, shows, films, music — whatever you're taking in."
              : `anything — reflections, plans, half-thoughts. writes stay on this ${scopeOf(noteKey)}.`
          }
          onChange={(next) => {
            valueRef.current = next;
            dirtyRef.current = true;
            setValue(next);
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = window.setTimeout(
              () => void saveRef.current(),
              700,
            );
          }}
          onSave={() => void saveRef.current()}
        />
      )}
    </div>
  );
}
