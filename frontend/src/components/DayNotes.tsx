import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

interface Props {
  date: string;
}

// Open-ended per-day notes. Saves on blur (fast, no debounce loops).
// Empty saves are fine — updateStopNotes upserts with empty string.
export function DayNotes({ date }: Props) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "saving">("idle");
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("idle");
    dirtyRef.current = false;
    api
      .stop(date)
      .then((stop) => {
        if (!cancelled) setValue(stop.notes ?? "");
      })
      .catch(() => {
        if (!cancelled) setValue("");
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const save = async () => {
    if (!dirtyRef.current) return;
    setStatus("saving");
    try {
      await api.saveNotes(date, value);
      dirtyRef.current = false;
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("idle");
    }
  };

  const dt = new Date(date + "T00:00:00");
  const heading = dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="daynotes">
      <div className="daynotes-head">
        <span className="daynotes-title">notes · {heading}</span>
        <span className={`daynotes-status ${status}`}>
          {status === "saving" ? "saving…" : status === "saved" ? "saved" : ""}
        </span>
      </div>
      <textarea
        className="daynotes-input"
        value={value}
        placeholder="anything — reflections, plans, half-thoughts. writes stay on this day."
        onChange={(e) => {
          dirtyRef.current = true;
          setValue(e.target.value);
        }}
        onBlur={save}
      />
    </div>
  );
}
