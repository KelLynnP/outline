import type React from "react";

// Minimal drag-drop for scheduling tasks onto calendar days.
// The task row is the drag source. Any element with a date is a drop target.
// On drop → PATCH item.due_date via the onDrop callback in the parent page.

const MIME = "text/task-id";

export function taskDragProps(id: number) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MIME, String(id));
      e.dataTransfer.effectAllowed = "move";
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
