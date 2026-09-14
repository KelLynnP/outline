import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  startOfWeekISO,
  type CaughtItem,
  type WeekStart,
} from "@life-console/shared";
import { api } from "../api.js";
import { useToggle } from "../useToggle.js";
import { MarkdownNoteEditor } from "./MarkdownNoteEditor.js";

type BuiltinScope = "day" | "week" | "month" | "year" | "media";
type Scope = BuiltinScope | `page:${string}`;

const BUILTIN_SCOPES: BuiltinScope[] = ["day", "week", "month", "year", "media"];

const DAY_MS = 86_400_000;

/** Custom named pages behave like "media" — single timeless note under a
 *  stable key ("page-<slug>"). Names are user-typed; slugs are derived. */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const short = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Note key for a scope anchored at a date. Day = plain date (stops.notes);
 *  week/month/year prefix keys go to period_notes. Media log is a single
 *  timeless note under the fixed key "media-log". */
function keyFor(scope: Scope, date: string, weekStartsOn: WeekStart): string {
  if (scope === "day") return date;
  if (scope === "week") return `week-${startOfWeekISO(date, weekStartsOn)}`;
  if (scope === "month") return `month-${date.slice(0, 7)}`;
  if (scope === "year") return `year-${date.slice(0, 4)}`;
  if (scope === "media") return "media-log";
  return `page-${scope.slice(5)}`; // page:<slug>
}

const scopeOf = (key: string): Scope => {
  if (key === "media-log") return "media";
  if (key.startsWith("week-")) return "week";
  if (key.startsWith("month-")) return "month";
  if (key.startsWith("year-")) return "year";
  if (key.startsWith("page-")) return `page:${key.slice(5)}`;
  return "day";
};

function labelFor(key: string, customPages: string[] = []): string {
  if (key.startsWith("page-")) {
    const slug = key.slice(5);
    return customPages.find((n) => slugify(n) === slug) ?? slug.replace(/-/g, " ");
  }
  const scope = scopeOf(key);
  switch (scope) {
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
    default:
      return key;
  }
}

/* Pins survive reloads. A pin is either a fixed note key ("week-2026-09-06",
 * locked to that period) or "follow:<scope>" (re-anchors to the selected
 * date as you navigate, so day + week can sit side by side). */
const PINS_KEY = "notes.pins";
const FOLLOW = "follow:";
const PRIMARY = "primary";
const PANE_ORDER_KEY = "notes.paneOrder";
const PANE_WIDTHS_KEY = "notes.paneWidths";
const CUSTOM_PAGES_KEY = "notes.customPages";
const loadPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const loadPaneWidths = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(PANE_WIDTHS_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const loadCustomPages = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PAGES_KEY) ?? "[]");
  } catch {
    return [];
  }
};

export type Theme = "light" | "sepia" | "dark";
const THEMES: Theme[] = ["light", "sepia", "dark"];
export const loadTheme = (): Theme => {
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
  items: CaughtItem[];
  onTasksChange: () => void | Promise<void>;
  // Lets the page repaint the surrounding section (header) in the same theme.
  onThemeChange?: (theme: Theme) => void;
}

// Notes panes: one follows the selected day/week/month, plus any pinned
// periods. Each period is its own note.
export function PeriodNotes({
  date,
  view,
  weekStartsOn,
  items,
  onTasksChange,
  onThemeChange,
}: Props) {
  const [pins, setPins] = useState<string[]>(loadPins);
  const [paneOrder, setPaneOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PANE_ORDER_KEY) ?? `["${PRIMARY}"]`);
    } catch {
      return [PRIMARY];
    }
  });
  const [paneWidths, setPaneWidths] = useState<Record<string, number>>(loadPaneWidths);
  const [customPages, setCustomPages] = useState<string[]>(loadCustomPages);
  const paneWidthsRef = useRef(paneWidths);
  paneWidthsRef.current = paneWidths;
  const panesRef = useRef<HTMLDivElement>(null);
  const [draggedPane, setDraggedPane] = useState<string | null>(null);
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
  const visiblePaneIds = [PRIMARY, ...visiblePins];
  const orderedPaneIds = [
    ...paneOrder.filter((id) => visiblePaneIds.includes(id)),
    ...visiblePaneIds.filter((id) => !paneOrder.includes(id)),
  ];

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    localStorage.setItem("notes.theme", next);
    setTheme(next);
  };

  useEffect(() => setScope(view), [view]);
  useEffect(() => onThemeChange?.(theme), [theme, onThemeChange]);

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
  const savePaneOrder = (next: string[]) => {
    setPaneOrder(next);
    localStorage.setItem(PANE_ORDER_KEY, JSON.stringify(next));
  };
  const savePaneWidths = (next: Record<string, number>) => {
    setPaneWidths(next);
    localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify(next));
  };
  const renamePaneWidth = (from: string, to: string) => {
    const w = paneWidths[from];
    if (w === undefined) return;
    const { [from]: _, ...rest } = paneWidths;
    savePaneWidths({ ...rest, [to]: w });
  };
  const dropPaneWidth = (id: string) => {
    if (paneWidths[id] === undefined) return;
    const { [id]: _, ...rest } = paneWidths;
    savePaneWidths(rest);
  };
  const addPin = (scope: Scope) => {
    setPicking(false);
    const pin = `${FOLLOW}${scope}`;
    if (!pins.includes(pin)) savePins([...pins, pin]);
  };
  const saveCustomPages = (next: string[]) => {
    setCustomPages(next);
    localStorage.setItem(CUSTOM_PAGES_KEY, JSON.stringify(next));
  };
  const addCustomPage = () => {
    const name = window.prompt("name for the new page")?.trim();
    if (!name) return;
    const slug = slugify(name);
    if (!slug) return;
    // dedupe by slug: if it already exists, just jump to it
    if (!customPages.some((p) => slugify(p) === slug)) {
      saveCustomPages([...customPages, name]);
    }
    setScope(`page:${slug}`);
  };
  const removeCustomPage = (name: string) => {
    if (!window.confirm(`remove "${name}" tab? the note itself stays saved.`)) return;
    saveCustomPages(customPages.filter((p) => p !== name));
    const slug = slugify(name);
    if (scope === `page:${slug}`) setScope("day");
    savePins(pins.filter((p) => p !== `page-${slug}` && p !== `${FOLLOW}page:${slug}`));
  };
  const replacePin = (pin: string, next: string) => {
    savePins(pins.map((p) => (p === pin ? next : p)));
    savePaneOrder(paneOrder.map((p) => (p === pin ? next : p)));
    renamePaneWidth(pin, next);
  };
  const movePane = (target: string) => {
    if (!draggedPane || draggedPane === target) return;
    const next = [...orderedPaneIds];
    const from = next.indexOf(draggedPane);
    const to = next.indexOf(target);
    next.splice(from, 1);
    next.splice(to, 0, draggedPane);
    savePaneOrder(next);
    setDraggedPane(null);
  };

  // Drag between two adjacent panes. Snapshot every pane's current pixel
  // width (so newly-added panes with no stored size get an explicit value),
  // then move only the boundary between L and R — their combined width
  // stays constant, so no other pane shifts and nothing can wrap.
  const startResize = (leftId: string, rightId: string, event: ReactMouseEvent) => {
    const container = panesRef.current;
    if (!container) return;
    event.preventDefault();
    const snapshot: Record<string, number> = {};
    container.querySelectorAll<HTMLElement>("[data-pane-id]").forEach((el) => {
      snapshot[el.dataset.paneId!] = el.offsetWidth;
    });
    const leftStart = snapshot[leftId];
    const rightStart = snapshot[rightId];
    const combined = leftStart + rightStart;
    const startX = event.clientX;
    const MIN = 180;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const newLeft = Math.max(MIN, Math.min(combined - MIN, leftStart + ev.clientX - startX));
      setPaneWidths({ ...snapshot, [leftId]: newLeft, [rightId]: combined - newLeft });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
      localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify(paneWidthsRef.current));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
          {BUILTIN_SCOPES.map((option) => (
            <button
              key={option}
              type="button"
              className={scope === option ? "active" : ""}
              onClick={() => setScope(option)}
            >
              {option}
            </button>
          ))}
          {customPages.map((name) => {
            const pageScope: Scope = `page:${slugify(name)}`;
            return (
              <button
                key={name}
                type="button"
                className={scope === pageScope ? "active" : ""}
                title="right-click to remove"
                onClick={() => setScope(pageScope)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  removeCustomPage(name);
                }}
              >
                {name}
              </button>
            );
          })}
          <button
            type="button"
            className="daynotes-add-page"
            title="new named page (like media)"
            onClick={addCustomPage}
          >
            +
          </button>
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
          {picking ? (
            <>
              {BUILTIN_SCOPES.map((s) => (
                <button
                  key={s}
                  className="pin-chip"
                  title={`open the ${s} note alongside — follows the timeline until you lock it`}
                  onClick={() => addPin(s)}
                >
                  {s}
                </button>
              ))}
              {customPages.map((name) => (
                <button
                  key={name}
                  className="pin-chip"
                  title={`open the "${name}" page alongside`}
                  onClick={() => addPin(`page:${slugify(name)}`)}
                >
                  {name}
                </button>
              ))}
            </>
          ) : (
            <button
              className="row-icon notes-add-pane"
              title="open another note alongside"
              onClick={() => setPicking(true)}
            >
              +
            </button>
          )}
        </div>
      </div>
      <div ref={panesRef} className={`daynotes-panes${stacked ? " stacked" : ""}`}>
        {orderedPaneIds.map((paneId, i) => {
          const pin = paneId === PRIMARY ? null : paneId;
          const grow = paneWidths[paneId] ?? 1;
          const divider = !stacked && i > 0 && (
            <div
              className="pane-divider"
              title="drag to resize"
              onMouseDown={(event) => startResize(orderedPaneIds[i - 1], paneId, event)}
            />
          );
          if (!pin) {
            return (
              <Fragment key={PRIMARY}>
                {divider}
                <NotePane
                  noteKey={primaryKey}
                  paneId={PRIMARY}
                  label={labelFor(primaryKey, customPages)}
                  items={items}
                  onTasksChange={onTasksChange}
                  grow={grow}
                  dragging={draggedPane === PRIMARY}
                  onDragStart={setDraggedPane}
                  onDrop={movePane}
                />
              </Fragment>
            );
          }
          const key = resolvePin(pin);
          const follows = pin.startsWith(FOLLOW);
          return (
            <Fragment key={pin}>
              {divider}
              <NotePane
                noteKey={key}
                paneId={pin}
                label={labelFor(key, customPages)}
                items={items}
                onTasksChange={onTasksChange}
                grow={grow}
                pinned
                dragging={draggedPane === pin}
                onDragStart={setDraggedPane}
                onDrop={movePane}
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
                      title="unpin"
                      onClick={() => {
                        savePins(pins.filter((p) => p !== pin));
                        savePaneOrder(paneOrder.filter((p) => p !== pin));
                        dropPaneWidth(pin);
                      }}
                    >
                      ×
                    </button>
                  </>
                }
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function NotePane({
  noteKey,
  paneId,
  label,
  items,
  onTasksChange,
  grow = 1,
  pinned = false,
  dragging = false,
  onDragStart,
  onDrop,
  actions,
}: {
  noteKey: string;
  paneId: string;
  label: string;
  items: CaughtItem[];
  onTasksChange: () => void | Promise<void>;
  grow?: number;
  pinned?: boolean;
  dragging?: boolean;
  onDragStart: (paneId: string) => void;
  onDrop: (paneId: string) => void;
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
    <div
      className={`notepane${pinned ? " pinned" : ""}${dragging ? " dragging" : ""}`}
      data-pane-id={paneId}
      style={{ flexGrow: grow }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(paneId);
      }}
    >
      <div className="daynotes-head">
        <span
          className="daynotes-title pane-drag-handle"
          draggable
          title="drag to move pane"
          onDragStart={(event: ReactDragEvent) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", paneId);
            onDragStart(paneId);
          }}
          onDragEnd={() => onDragStart("")}
        >
          ⠿ notes · {label}
        </span>
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
          items={items}
          emptyText={
            noteKey === "media-log"
              ? "books, shows, films, music — whatever you're taking in."
              : noteKey.startsWith("page-")
                ? "anything — this page keeps its own note, no dates attached."
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
          onTasksChange={onTasksChange}
        />
      )}
    </div>
  );
}
