import { useState } from "react";
import type { CaughtItem, Priority, Settings } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  settings: Settings;
  onCreated: () => void;
  compact?: boolean;
}

export function TaskComposer({ settings, onCreated, compact = false }: Props) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>(2);
  const [tagInput, setTagInput] = useState("");
  const [urgent, setUrgent] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    const tags = tagInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    await api.addItem({
      text: text.trim(),
      tag: urgent ? settings.tags.urgent : settings.tags.normal,
      due_date: dueDate || null,
      priority,
      tags,
    });
    setText("");
    setDueDate("");
    setPriority(2);
    setTagInput("");
    setUrgent(false);
    onCreated();
  };

  return (
    <div className={`composer ${compact ? "composer-compact" : ""}`}>
      <input
        className="composer-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey || compact)) submit();
        }}
        placeholder="capture a task…"
      />
      <div className="composer-row">
        <div className="composer-prio" role="radiogroup">
          {[1, 2, 3].map((p) => (
            <button
              key={p}
              className={`prio prio-${p} ${priority === p ? "active" : ""}`}
              onClick={() => setPriority(p as Priority)}
              title={`P${p}`}
            >
              P{p}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="composer-date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <input
          className="composer-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="tags (comma)"
        />
        <label className="composer-urgent">
          <input
            type="checkbox"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />
          urgent
        </label>
        <button className="composer-submit" onClick={submit}>
          add
        </button>
      </div>
    </div>
  );
}

export function TaskMeta({ item }: { item: CaughtItem }) {
  const due = item.due_date ? new Date(item.due_date + "T00:00:00") : null;
  const now = new Date();
  const daysUntil = due
    ? Math.ceil((due.getTime() - now.getTime()) / 86400_000)
    : null;
  const dueClass =
    daysUntil === null
      ? ""
      : daysUntil < 0
        ? "overdue"
        : daysUntil <= 1
          ? "soon"
          : "later";
  return (
    <span className="task-meta">
      <span className={`prio-chip prio-${item.priority}`}>P{item.priority}</span>
      {due && (
        <span className={`due-chip ${dueClass}`}>
          {daysUntil !== null && daysUntil < 0
            ? `${-daysUntil}d overdue`
            : daysUntil === 0
              ? "today"
              : daysUntil === 1
                ? "tomorrow"
                : due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
      {item.tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
        </span>
      ))}
    </span>
  );
}
