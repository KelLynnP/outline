import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  localDateISO,
  type RoadmapEntry,
  type RoadmapLane,
} from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  selectedISO: string;
}

type DragPayload = { id: number; mode: "move" | "start" | "end" };
type DragPreview = {
  id: number;
  laneId: number;
  start: string;
  end: string;
  kind: RoadmapEntry["kind"];
  color: string;
  transparent: boolean;
  opacity: number;
  row: number;
  title: string;
};

const DAY_MS = 86_400_000;
const DEFAULT_COLOR = "#547a68";
const ZOOM_LEVELS = [7, 14, 42, 84, 168];

const parse = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  iso(new Date(parse(date).getTime() + days * DAY_MS));
const dayDiff = (from: string, to: string) =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);

function readableText(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 155 ? "#292823" : "#fff";
}

function pack(entries: RoadmapEntry[]) {
  const ends: string[] = [];
  const reserved = new Set(
    entries
      .map((entry) => entry.row_position)
      .filter((row): row is number => row !== null),
  );
  return [...entries]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((entry) => {
      const end = entry.end_date ?? entry.start_date;
      let level = entry.row_position;
      if (level === null) {
        level = 0;
        while (
          reserved.has(level) ||
          (ends[level] !== undefined && ends[level] >= entry.start_date)
        ) {
          level += 1;
        }
      }
      ends[level] = end;
      return { entry, level };
    });
}

export function Roadmap({ selectedISO }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(84);
  const [anchor, setAnchor] = useState(selectedISO);
  const [lanes, setLanes] = useState<RoadmapLane[]>([]);
  const [entries, setEntries] = useState<RoadmapEntry[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"span" | "milestone">("span");
  const [laneId, setLaneId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(selectedISO);
  const [endDate, setEndDate] = useState(addDays(selectedISO, 6));
  const [theme, setTheme] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [rowPosition, setRowPosition] = useState<number | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [published, setPublished] = useState(false);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [showTransparent, setShowTransparent] = useState(true);
  const [hiddenThemes, setHiddenThemes] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [newLane, setNewLane] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState("");
  const colorPopoverRef = useRef<HTMLDivElement>(null);

  const dayWidth =
    days === 7 ? 72 : days === 14 ? 44 : days === 42 ? 26 : days === 84 ? 18 : 12;
  const from = useMemo(() => addDays(anchor, -Math.round(days / 3)), [anchor, days]);
  const to = useMemo(() => addDays(from, days - 1), [from, days]);

  const load = useCallback(async () => {
    const [nextLanes, nextEntries] = await Promise.all([
      api.roadmapLanes(),
      api.roadmapEntries(from, to),
    ]);
    setLanes(nextLanes);
    setEntries(nextEntries);
    setLaneId((current) =>
      current && nextLanes.some((lane) => lane.id === current)
        ? current
        : (nextLanes[0]?.id ?? null),
    );
  }, [from, to]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [expanded]);

  useEffect(() => {
    if (!colorPopoverOpen) return;
    const close = (event: PointerEvent) => {
      if (!colorPopoverRef.current?.contains(event.target as Node)) {
        setColorPopoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [colorPopoverOpen]);

  const dates = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(from, index)),
    [days, from],
  );
  const months = useMemo(() => {
    const result: { label: string; start: number; count: number }[] = [];
    for (let i = 0; i < dates.length; i += 1) {
      const label = parse(dates[i]).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      const last = result[result.length - 1];
      if (last?.label === label) last.count += 1;
      else result.push({ label, start: i, count: 1 });
    }
    return result;
  }, [dates]);
  const themeLegend = useMemo(() => {
    const byTheme = new Map<string, string>();
    for (const entry of entries) {
      const key = entry.theme ?? "";
      if (!byTheme.has(key)) byTheme.set(key, entry.color);
    }
    return [...byTheme].map(([key, themeColor]) => ({
      key,
      label: key || "unthemed",
      color: themeColor,
    }));
  }, [entries]);
  const visibleEntries = entries.filter(
    (entry) =>
      !hiddenThemes.has(entry.theme ?? "") && (showTransparent || !entry.transparent),
  );

  useEffect(() => {
    if (!editingId || !laneId || !title.trim()) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      api
        .updateRoadmapEntry(editingId, {
          lane_id: laneId,
          title: title.trim(),
          kind,
          start_date: startDate,
          end_date: kind === "span" ? endDate : null,
          notes: null,
          theme: theme.trim() || null,
          color,
          row_position: rowPosition,
          transparent,
          opacity,
          published,
        })
        .then(async () => {
          setSaveState("saved");
          await load();
        })
        .catch((error) => {
          console.error(error);
          setSaveState("idle");
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    color,
    editingId,
    endDate,
    kind,
    laneId,
    load,
    opacity,
    published,
    rowPosition,
    startDate,
    theme,
    title,
    transparent,
  ]);

  const resetForm = () => {
    setTitle("");
    setKind("span");
    setStartDate(anchor);
    setEndDate(addDays(anchor, 6));
    setTheme("");
    setColor(DEFAULT_COLOR);
    setRowPosition(null);
    setTransparent(false);
    setOpacity(1);
    setPublished(false);
    setColorPopoverOpen(false);
    setSaveState("idle");
    setEditingId(null);
  };

  const saveEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !laneId) return;
    const matchingTheme = entries.find(
      (entry) =>
        entry.id !== editingId &&
        (entry.theme ?? "").toLowerCase() === theme.trim().toLowerCase(),
    );
    const body = {
      lane_id: laneId,
      title: title.trim(),
      kind,
      start_date: startDate,
      end_date: kind === "span" ? endDate : null,
      notes: null,
      theme: theme.trim() || null,
      color: matchingTheme?.color ?? color,
      row_position: rowPosition,
      transparent,
      opacity,
      published,
    };
    if (editingId) await api.updateRoadmapEntry(editingId, body);
    else await api.addRoadmapEntry(body);
    resetForm();
    await load();
  };

  const editEntry = (entry: RoadmapEntry) => {
    setEditingId(entry.id);
    setTitle(entry.title);
    setKind(entry.kind);
    setLaneId(entry.lane_id);
    setStartDate(entry.start_date);
    setEndDate(entry.end_date ?? entry.start_date);
    setTheme(entry.theme ?? "");
    setColor(entry.color);
    setRowPosition(entry.row_position);
    setTransparent(entry.transparent);
    setOpacity(entry.opacity);
    setPublished(entry.published);
    setSaveState("saved");
    if (!expanded) setExpanded(true);
  };

  const addLane = async (event: FormEvent) => {
    event.preventDefault();
    if (!newLane.trim()) return;
    const lane = await api.addRoadmapLane({ name: newLane.trim() });
    setNewLane("");
    setLaneId(lane.id);
    await load();
  };

  const beginDrag = (
    event: DragEvent,
    entry: RoadmapEntry,
    mode: DragPayload["mode"],
  ) => {
    event.stopPropagation();
    const payload = { id: entry.id, mode };
    setDragging(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-roadmap-entry",
      JSON.stringify(payload),
    );
    event.dataTransfer.setData("text/plain", entry.title);
  };

  const previewEntry = (
    event: DragEvent<HTMLDivElement>,
    lane: RoadmapLane,
  ): DragPreview | null => {
    if (!dragging) return null;
    const payload = dragging;
    const entry = entries.find((candidate) => candidate.id === payload.id);
    if (!entry) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.max(
      0,
      Math.min(days - 1, Math.floor((event.clientX - rect.left) / dayWidth)),
    );
    const date = addDays(from, index);
    let start = entry.start_date;
    let end = entry.end_date ?? entry.start_date;
    if (payload.mode === "move") {
      const duration = dayDiff(entry.start_date, entry.end_date ?? entry.start_date);
      start = date;
      end = entry.kind === "span" ? addDays(date, duration) : date;
    } else if (payload.mode === "start") {
      start = date <= end ? date : end;
    } else if (payload.mode === "end") {
      end = date >= start ? date : start;
    }
    return {
      id: entry.id,
      laneId: lane.id,
      start,
      end,
      kind: entry.kind,
      color: entry.color,
      transparent: entry.transparent,
      opacity: entry.opacity,
      row: entry.row_position ?? 0,
      title: entry.title,
    };
  };

  const dropEntry = async (event: DragEvent<HTMLDivElement>, lane: RoadmapLane) => {
    event.preventDefault();
    const preview = previewEntry(event, lane);
    setDragging(null);
    setDragPreview(null);
    if (!preview) return;
    await api.updateRoadmapEntry(preview.id, {
      lane_id: preview.laneId,
      start_date: preview.start,
      end_date: preview.kind === "span" ? preview.end : null,
    });
    await load();
  };

  const chooseDate = (date: string, setEnd: boolean) => {
    if (setEnd && kind === "span") {
      if (date >= startDate) setEndDate(date);
    } else {
      setStartDate(date);
      if (kind === "span" && endDate < date) setEndDate(date);
    }
    setExpanded(true);
  };

  const syncPublished = async () => {
    setPublishing(true);
    setPublishMessage("checking…");
    try {
      const preview = await api.publishRoadmap(true);
      const total = preview.created + preview.updated + preview.deleted;
      if (total === 0) {
        setPublishMessage("company calendar is up to date");
        return;
      }
      const approved = window.confirm(
        `Publish roadmap to the company calendar?\n\nCreate ${preview.created} · update ${preview.updated} · delete ${preview.deleted}`,
      );
      if (!approved) {
        setPublishMessage("sync cancelled");
        return;
      }
      const result = await api.publishRoadmap(false);
      setPublishMessage(
        `synced: ${result.created} created · ${result.updated} updated · ${result.deleted} deleted`,
      );
    } catch (error) {
      console.error(error);
      setPublishMessage("sync failed");
    } finally {
      setPublishing(false);
    }
  };

  const today = localDateISO();
  const chartWidth = days * dayWidth;
  const todayIndex = dayDiff(from, today);

  const chart = (
    <div
      className="roadmap-canvas"
      style={{ "--day-width": `${dayWidth}px`, minWidth: chartWidth + 148 } as CSSProperties}
    >
      <div className="roadmap-axis">
        <div className="roadmap-axis-corner">
          <span>lane</span>
          <small>click day · shift-click end</small>
        </div>
        <div className="roadmap-axis-time" style={{ width: chartWidth }}>
          <div className="roadmap-months">
            {months.map((month) => (
              <div
                key={`${month.label}-${month.start}`}
                style={{ width: month.count * dayWidth }}
              >
                {month.label}
              </div>
            ))}
          </div>
          <div className="roadmap-weeks">
            {dates.map((date) => {
              const day = parse(date);
              return (
                <button
                  key={date}
                  className={`${date === today ? "today" : ""} ${
                    day.getUTCDay() === 0 || day.getUTCDay() === 6 ? "weekend" : ""
                  }`}
                  onClick={(event) => chooseDate(date, event.shiftKey)}
                  title={`${date}: click for start, shift-click for end`}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {lanes.map((lane) => {
        const packed = pack(visibleEntries.filter((entry) => entry.lane_id === lane.id));
        const levels = Math.max(1, ...packed.map(({ level }) => level + 1));
        const preview = dragPreview?.laneId === lane.id ? dragPreview : null;
        const previewLevel = preview?.row ?? 0;
        const rowHeight = Math.max(levels, previewLevel + 1) * 30 + 16;
        return (
          <div className="roadmap-row" style={{ height: rowHeight }} key={lane.id}>
            <div
              className="roadmap-lane-label"
              onDoubleClick={() => {
                const name = window.prompt("Lane name", lane.name);
                if (name?.trim()) {
                  api.updateRoadmapLane(lane.id, { name }).then(load).catch(console.error);
                }
              }}
              title="Double-click to rename"
            >
              <span>{lane.name}</span>
              <button
                disabled={lanes.length === 1}
                onClick={async () => {
                  if (
                    lanes.length > 1 &&
                    window.confirm(`Delete “${lane.name}” and everything in it?`)
                  ) {
                    await api.deleteRoadmapLane(lane.id);
                    await load();
                  }
                }}
                title={
                  lanes.length === 1
                    ? "Keep at least one lane"
                    : `Delete ${lane.name}`
                }
              >
                ×
              </button>
            </div>
            <div
              className="roadmap-track"
              style={{ width: chartWidth }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragPreview(previewEntry(event, lane));
              }}
              onDrop={(event) => void dropEntry(event, lane)}
            >
              {dates.map((date) => (
                <i
                  key={date}
                  className={`${parse(date).getUTCDay() === 1 ? "week-start" : ""} ${
                    date === today ? "today-cell" : ""
                  } ${
                    parse(date).getUTCDay() === 0 || parse(date).getUTCDay() === 6
                      ? "weekend"
                      : ""
                  }`}
                />
              ))}
              {todayIndex >= 0 && todayIndex < days && (
                <span
                  className="roadmap-today-line"
                  style={{ left: todayIndex * dayWidth }}
                />
              )}
              {preview &&
                (() => {
                  const start = Math.max(0, dayDiff(from, preview.start));
                  const end = Math.min(days - 1, dayDiff(from, preview.end));
                  const left = start * dayWidth;
                  const width = Math.max(dayWidth, (end - start + 1) * dayWidth);
                  return (
                    <span
                      className={`roadmap-drop-preview ${
                        preview.kind === "milestone" ? "milestone" : ""
                      }`}
                      style={{
                        left:
                          preview.kind === "milestone"
                            ? left + dayWidth / 2
                            : left,
                        top: 8 + preview.row * 30,
                        width: preview.kind === "milestone" ? 18 : width,
                        borderColor: preview.color,
                        background:
                          preview.kind === "milestone" || !preview.transparent
                            ? preview.color
                            : "transparent",
                        opacity: preview.opacity,
                      }}
                    >
                      {preview.kind === "span" && (
                        <b
                          style={{
                            color: preview.transparent
                              ? preview.color
                              : readableText(preview.color),
                          }}
                        >
                          {preview.title}
                        </b>
                      )}
                    </span>
                  );
                })()}
              {packed.map(({ entry, level }) => {
                const start = Math.max(0, dayDiff(from, entry.start_date));
                const end = Math.min(days - 1, dayDiff(from, entry.end_date ?? entry.start_date));
                const left = start * dayWidth;
                const width = Math.max(dayWidth, (end - start + 1) * dayWidth);
                if (entry.kind === "milestone") {
                  return (
                    <button
                      key={entry.id}
                      className={`roadmap-milestone ${entry.transparent ? "transparent" : ""} ${
                        entry.published ? "published" : ""
                      }`}
                      style={{
                        left: left + dayWidth / 2,
                        top: 12 + level * 30,
                        opacity: entry.opacity,
                      }}
                      draggable
                      onDragStart={(event) => beginDrag(event, entry, "move")}
                      onDragEnd={() => {
                        setDragging(null);
                        setDragPreview(null);
                      }}
                      onClick={() => editEntry(entry)}
                      title={`${entry.title} — ${entry.start_date}${
                        entry.published ? " — PUBLISHED" : ""
                      }`}
                    >
                      <span
                        style={{
                          background: entry.transparent ? "transparent" : entry.color,
                          borderColor: entry.color,
                        }}
                      />
                      <b>{entry.title}</b>
                    </button>
                  );
                }
                return (
                  <button
                    key={entry.id}
                    className={`roadmap-bar ${entry.transparent ? "transparent" : ""} ${
                      entry.published ? "published" : ""
                    }`}
                    style={{
                      left,
                      top: 8 + level * 30,
                      width,
                      background: entry.transparent ? "transparent" : entry.color,
                      borderColor: entry.color,
                      color: entry.transparent ? entry.color : readableText(entry.color),
                      opacity: entry.opacity,
                    }}
                    draggable
                    onDragStart={(event) => beginDrag(event, entry, "move")}
                    onDragEnd={() => {
                      setDragging(null);
                      setDragPreview(null);
                    }}
                    onClick={() => editEntry(entry)}
                    title={`${entry.title} — ${entry.start_date} to ${entry.end_date}${
                      entry.published ? " — PUBLISHED" : ""
                    }`}
                  >
                    <span
                      className="roadmap-resize start"
                      draggable
                      onDragStart={(event) => beginDrag(event, entry, "start")}
                    />
                    <b>{entry.title}</b>
                    <span
                      className="roadmap-resize end"
                      draggable
                      onDragStart={(event) => beginDrag(event, entry, "end")}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {lanes.length === 0 && <div className="roadmap-empty">Add a lane to begin.</div>}
    </div>
  );

  const controls = (showPublish: boolean) => (
    <div className="roadmap-controls">
      <div className="roadmap-range-nav">
        <button onClick={() => setAnchor(addDays(anchor, -Math.round(days / 2)))}>‹</button>
        <button onClick={() => setAnchor(today)}>today</button>
        <button onClick={() => setAnchor(addDays(anchor, Math.round(days / 2)))}>›</button>
      </div>
      <div className="roadmap-theme-filters" aria-label="Filter themes">
        {entries.some((entry) => entry.transparent) && (
          <button
            className={showTransparent ? "" : "hidden"}
            onClick={() => setShowTransparent((current) => !current)}
            title={`${showTransparent ? "Hide" : "Show"} outline spans`}
          >
            ◇ outlines
          </button>
        )}
        {themeLegend.map((item) => (
          <button
            key={item.key}
            className={hiddenThemes.has(item.key) ? "hidden" : ""}
            onClick={() =>
              setHiddenThemes((current) => {
                const next = new Set(current);
                if (next.has(item.key)) next.delete(item.key);
                else next.add(item.key);
                return next;
              })
            }
            title={`${hiddenThemes.has(item.key) ? "Show" : "Hide"} ${item.label}`}
          >
            <i style={{ background: item.color }} />
            {item.label}
          </button>
        ))}
      </div>
      {showPublish && (
        <div className="roadmap-publish-actions">
          <button
            className="roadmap-publish-sync"
            onClick={() => void syncPublished()}
            disabled={publishing}
          >
            {publishing ? "SYNCING…" : "SYNC PUBLISHED"}
          </button>
          {publishMessage && <span>{publishMessage}</span>}
        </div>
      )}
      <div className="roadmap-zoom" aria-label="Timeline scale">
        <button
          onClick={() =>
            setDays(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(days) + 1)])
          }
          disabled={days === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          title="Zoom out"
        >
          −
        </button>
        <span>{days} days</span>
        <button
          onClick={() => setDays(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(days) - 1)])}
          disabled={days === ZOOM_LEVELS[0]}
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );

  const editor = (
    <div className="roadmap-editor">
      <form className="roadmap-entry-form" onSubmit={(event) => void saveEntry(event)}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a span or milestone…"
          aria-label="Roadmap entry title"
        />
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="span">span</option>
          <option value="milestone">milestone</option>
        </select>
        <select
          value={laneId ?? ""}
          onChange={(event) => setLaneId(Number(event.target.value))}
          aria-label="Lane"
        >
          {lanes.map((lane) => (
            <option value={lane.id} key={lane.id}>
              {lane.name}
            </option>
          ))}
        </select>
        <input
          value={theme}
          onChange={(event) => {
            const value = event.target.value;
            setTheme(value);
            const match = themeLegend.find(
              (item) => item.key.toLowerCase() === value.trim().toLowerCase(),
            );
            if (match) setColor(match.color);
          }}
          placeholder="Theme / tag"
          aria-label="Theme or tag"
          list="roadmap-themes"
        />
        <datalist id="roadmap-themes">
          {themeLegend
            .filter((item) => item.key)
            .map((item) => (
              <option value={item.key} key={item.key} />
            ))}
        </datalist>
        <div className="roadmap-color-control" ref={colorPopoverRef}>
          <button
            type="button"
            className="roadmap-color-trigger"
            onClick={() => setColorPopoverOpen((open) => !open)}
            aria-label="Edit color and opacity"
            aria-expanded={colorPopoverOpen}
            title="Color and opacity"
          >
            <span style={{ background: color, opacity }} />
          </button>
          {colorPopoverOpen && (
            <div className="roadmap-color-popover">
              <div className="roadmap-color-popover-head">
                <strong>appearance</strong>
                <button type="button" onClick={() => setColorPopoverOpen(false)}>
                  ×
                </button>
              </div>
              <label className="roadmap-system-color">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
                <span>system color…</span>
              </label>
              <label className="roadmap-hex-color">
                <span>hex</span>
                <input
                  key={color}
                  defaultValue={color}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (/^#[0-9a-f]{6}$/i.test(value)) setColor(value);
                    else event.target.value = color;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="roadmap-opacity">
                <span>opacity</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={Math.round(opacity * 100)}
                  onChange={(event) => setOpacity(Number(event.target.value) / 100)}
                />
                <output>{Math.round(opacity * 100)}%</output>
              </label>
            </div>
          )}
        </div>
        <input
          className="roadmap-row-input"
          type="number"
          min="1"
          value={rowPosition === null ? "" : rowPosition + 1}
          onChange={(event) =>
            setRowPosition(
              event.target.value ? Math.max(0, Number(event.target.value) - 1) : null,
            )
          }
          placeholder="auto row"
          aria-label="Manual row number"
          title="Leave blank to place automatically"
        />
        <label className="roadmap-transparent-toggle">
          <input
            type="checkbox"
            checked={transparent}
            onChange={(event) => setTransparent(event.target.checked)}
          />
          outline
        </label>
        <label className={`roadmap-publish-toggle ${published ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />
          PUBLISH THIS
        </label>
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          aria-label="Start date"
        />
        {kind === "span" && (
          <input
            type="date"
            min={startDate}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            aria-label="End date"
          />
        )}
        <button type="submit">{editingId ? "done" : "add"}</button>
        {editingId && (
          <>
            <span className={`roadmap-save-state ${saveState}`}>{saveState}</span>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const id = editingId;
                setEditingId(null);
                await api.deleteRoadmapEntry(id);
                resetForm();
                await load();
              }}
            >
              delete
            </button>
          </>
        )}
      </form>
      <form className="roadmap-lane-form" onSubmit={(event) => void addLane(event)}>
        <input
          value={newLane}
          onChange={(event) => setNewLane(event.target.value)}
          placeholder="New lane"
          aria-label="New lane name"
        />
        <button type="submit">+ lane</button>
      </form>
    </div>
  );

  return (
    <>
      <section className="roadmap roadmap-embedded">
        <div className="roadmap-head">
          <div>
            <strong>roadmap</strong>
            <span>spans & milestones</span>
          </div>
          <button className="roadmap-expand" onClick={() => setExpanded(true)}>
            fullscreen ↗
          </button>
        </div>
        {controls(false)}
        <div className="roadmap-scroll">{chart}</div>
      </section>

      {expanded && (
        <div className="roadmap-overlay" role="dialog" aria-modal="true" aria-label="Roadmap">
          <div className="roadmap-full-head">
            <div>
              <strong>roadmap</strong>
              <span>
                Drag to move · drag edges to resize · click a day to set dates
              </span>
            </div>
            <button onClick={() => setExpanded(false)} aria-label="Close roadmap">
              close ×
            </button>
          </div>
          {editor}
          {controls(true)}
          <div className="roadmap-scroll roadmap-full-scroll">{chart}</div>
        </div>
      )}
    </>
  );
}
