import type React from "react";

// Minimal drag-drop for scheduling tasks onto calendar days.
// The task row is the drag source. Any element with a date is a drop target.
// On drop → PATCH item.due_date via the onDrop callback in the parent page.

export const TASK_MIME = "text/task-id";
const MIME = TASK_MIME;
// Duration and source id ride in the type names so drop targets can read
// them during dragover (getData is blocked until drop, types are visible).
const DUR_PREFIX = "text/task-dur-";
const SRC_PREFIX = "text/task-src-";

export function taskDragProps(id: number, durationMin?: number) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MIME, String(id));
      e.dataTransfer.setData(SRC_PREFIX + id, "");
      if (durationMin) e.dataTransfer.setData(DUR_PREFIX + durationMin, "");
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** Id of the task being dragged, readable during dragover. */
export function dragSourceId(dt: DataTransfer): number | null {
  for (const t of dt.types) {
    if (t.startsWith(SRC_PREFIX)) {
      const n = Number(t.slice(SRC_PREFIX.length));
      if (n > 0) return n;
    }
  }
  return null;
}

// Manual calendar events are drag sources too (moving them re-times them).
export const EVENT_MIME = "text/event-id";

export function eventDragProps(id: number, durationMin?: number) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(EVENT_MIME, String(id));
      if (durationMin) e.dataTransfer.setData(DUR_PREFIX + durationMin, "");
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

export function dragDurationMin(dt: DataTransfer): number | null {
  for (const t of dt.types) {
    if (t.startsWith(DUR_PREFIX)) {
      const n = Number(t.slice(DUR_PREFIX.length));
      if (n > 0) return n;
    }
  }
  return null;
}

// Drop target that just wants the task id (e.g. "done" section = complete).
// `ignoreId` lets a row-target opt out when the dragged task is itself.
export function taskDropProps(
  onDropItem: (id: number) => void,
  className = "drop-over",
  ignoreId?: number,
) {
  const relevant = (dt: DataTransfer) =>
    dt.types.includes(MIME) &&
    (ignoreId === undefined || dragSourceId(dt) !== ignoreId);
  return {
    onDragOver: (e: React.DragEvent) => {
      if (relevant(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation(); // don't also highlight the parent section
        e.currentTarget.classList.add(className);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        e.currentTarget.classList.remove(className);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!relevant(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation(); // nested row drops shouldn't also hit the section
      e.currentTarget.classList.remove(className);
      const id = Number(e.dataTransfer.getData(MIME));
      if (id) onDropItem(id);
    },
  };
}

export function dayDropProps(
  date: string,
  onDrop: (id: number, date: string) => void,
  className = "drop-over",
) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(MIME)) {
        e.preventDefault();
        e.currentTarget.classList.add(className);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      e.currentTarget.classList.remove(className);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.currentTarget.classList.remove(className);
      const raw = e.dataTransfer.getData(MIME);
      const id = Number(raw);
      if (id) onDrop(id, date);
    },
  };
}
