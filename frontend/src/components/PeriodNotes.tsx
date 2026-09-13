import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  startOfWeekISO,
  type WeekStart,
} from "@life-console/shared";
import { api } from "../api.js";
import { useToggle } from "../useToggle.js";
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

/* Pins survive reloads. A pin is either a fixed note key ("week-2026-09-06",
 * locked to that period) or "follow:<scope>" (re-anchors to the selected
 * date as you navigate, so day + week can sit side by side). */
const PINS_KEY = "notes.pins";
const FOLLOW = "follow:";
const loadPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
  } catch {
    return [];
  }
};

type Theme = "light" | "sepia" | "dark";
const THEMES: Theme[] = ["light", "sepia", "dark"];
const loadTheme = (): Theme => {
  const stored = localStorage.getItem("notes.theme") as Theme | null;
  if (stored && THEMES.includes(stored)) return stored;
  return localStorage.getItem("notes.dark") === "1" ? "dark" : "light";
};

// Coarse steps: the top end is "a few words fill the screen".
const ZOOM_STEPS = [13, 15, 18, 22, 27, 34, 44, 56, 72];
const ZOOM_DEFAULT = 15;
// Horizontal padding inside the editor, for narrowing the text column.
const PAD_STEPS = [20, 48, 96, 160, 240, 340];
const PAD_DEFAULT = 20;

/** Persisted value snapped to `steps`; returns [value, step(dir), reset]. */
function useStepped(key: string, steps: number[], fallback: number) {
  const snap = (n: number) =>
    steps.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
  const [value, setValue] = useState(() =>
    snap(Number(localStorage.getItem(key)) || fallback),
  );
  const set = (n: number) => {
    localStorage.setItem(key, String(n));
    setValue(n);
  };
  const step = (dir: -1 | 1) => {
    const i = Math.min(steps.length - 1, Math.max(0, steps.indexOf(value) + dir));
    set(steps[i]);
  };
  return [value, step, () => set(fallback)] as const;
}

function Stepper({
  label,
  value,
  steps,
  onStep,
  onReset,
}: {
  label: string;
  value: number;
  steps: number[];
  onStep: (dir: -1 | 1) => void;
  onReset: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="row-icon"
        title={`smaller ${label}`}
        disabled={value <= steps[0]}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <button
        type="button"
        className="row-icon stepper-value"
        title={`reset ${label}`}
        onClick={onReset}
      >
        {value}
      </button>
      <button
        type="button"
        className="row-icon"
        title={`larger ${label}`}
        disabled={value >= steps[steps.length - 1]}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </>
  );
}

interface Props {
  date: string;
  view: "day" | "week" | "month";
  weekStartsOn: WeekStart;
}

// Notes panes: one follows the selected day/week/month, plus any pinned
// periods. Each period is its own note.
export function PeriodNotes({ date, view, weekStartsOn }: Props) {
  const [pins, setPins] = useState<string[]>(loadPins);
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scope, setScope] = useState<Scope>(view);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [zoom, stepZoom, resetZoom] = useStepped("notes.zoom", ZOOM_STEPS, ZOOM_DEFAULT);
  const [pad, stepPad, resetPad] = useStepped("notes.pad", PAD_STEPS, PAD_DEFAULT);
  const [stacked, toggleStacked] = useToggle("notes.stacked", false);
  const primaryKey = keyFor(scope, date, weekStartsOn);

  const resolvePin = (pin: string) =>
    pin.startsWith(FOLLOW)
      ? keyFor(pin.slice(FOLLOW.length) as Scope, date, weekStartsOn)
      : pin;
  // Drop pins that currently resolve to the primary or to an earlier pin.
  const visiblePins = pins.filter(
    (pin, i) =>
      resolvePin(pin) !== primaryKey &&
      pins.findIndex((p) => resolvePin(p) === resolvePin(pin)) === i,
  );

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    localStorage.setItem("notes.theme", next);
    setTheme(next);
  };

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
    const pin = `${FOLLOW}${scope}`;
    if (!pins.includes(pin)) savePins([...pins, pin]);
  };
  const replacePin = (pin: string, next: string) =>
    savePins(pins.map((p) => (p === pin ? next : p)));
  const movePin = (pin: string, dir: -1 | 1) => {
    const i = pins.indexOf(pin);
    const j = i + dir;
    if (j < 0 || j >= pins.length) return;
    const next = [...pins];
    [next[i], next[j]] = [next[j], next[i]];
    savePins(next);
  };

  const themeTitle =
    theme === "light" ? "sepia notes" : theme === "sepia" ? "dark notes" : "light notes";

  return (
    <div
      className={`daynotes${focused ? " focused" : ""}${theme === "light" ? "" : ` ${theme}`}`}
      style={{ "--note-fs": `${zoom}px`, "--note-pad": `${pad}px` } as CSSProperties}
    >
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
          <span className="stepper-label" title="text size">A</span>
          <Stepper label="text" value={zoom} steps={ZOOM_STEPS} onStep={stepZoom} onReset={resetZoom} />
          <span className="stepper-label" title="side padding">↔</span>
          <Stepper label="side padding" value={pad} steps={PAD_STEPS} onStep={stepPad} onReset={resetPad} />
          <button
            type="button"
            className="row-icon"
            title={themeTitle}
            onClick={cycleTheme}
          >
            {theme === "light" ? "◐" : theme === "sepia" ? "☾" : "☀"}
          </button>
          <button
            type="button"
            className="row-icon"
            title={stacked ? "panes side by side" : "stack panes"}
            onClick={toggleStacked}
          >
            {stacked ? "▥" : "▤"}
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
      <div className={`daynotes-panes${stacked ? " stacked" : ""}`}>
        <NotePane key={primaryKey} noteKey={primaryKey} />
        {visiblePins.map((pin, i) => {
          const key = resolvePin(pin);
          const follows = pin.startsWith(FOLLOW);
          return (
            <NotePane
              key={key}
              noteKey={key}
              pinned
              actions={
                <>
                  <button
                    className="pin-chip"
                    title={
                      follows
                        ? "follows the timeline — click to lock to this period"
                        : "locked to this period — click to follow the timeline"
                    }
                    onClick={() =>
                      replacePin(pin, follows ? key : `${FOLLOW}${scopeOf(key)}`)
                    }
                  >
                    {follows ? "follows" : "locked"}
                  </button>
                  <button
                    className="row-icon"
                    title="move pane back"
                    disabled={i === 0}
                    onClick={() => movePin(pin, -1)}
                  >
                    ‹
                  </button>
                  <button
                    className="row-icon"
                    title="move pane forward"
                    disabled={i === visiblePins.length - 1}
                    onClick={() => movePin(pin, 1)}
                  >
                    ›
                  </button>
                  <button
                    className="row-icon"
                    title="unpin"
                    onClick={() => savePins(pins.filter((p) => p !== pin))}
                  >
                    ×
                  </button>
                </>
              }
            />
          );
        })}
        <div className="daynotes-pin">
          {picking ? (
            SCOPES.map((s) => (
              <button
                key={s}
                className="pin-chip"
                title={`open the ${s} note alongside — follows the timeline until you lock it`}
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
  actions,
}: {
  noteKey: string;
  pinned?: boolean;
  actions?: ReactNode;
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
          {actions}
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
