import { useState } from "react";
import type { Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  today: TodayView;
  settings: Settings;
  onChange: () => void;
}

export function Face({ today, settings, onChange }: Props) {
  const [priorities, setPriorities] = useState<string[]>(["", "", ""]);
  const [reflection, setReflection] = useState("");

  const setPriority = (i: number, v: string) =>
    setPriorities((p) => p.map((x, idx) => (idx === i ? v : x)));

  const savePriorities = async () => {
    for (const p of priorities.filter((x) => x.trim())) {
      await api.addItem({ text: p.trim() });
    }
    setPriorities(["", "", ""]);
    onChange();
  };

  if (today.face === "morning") {
    return (
      <div className="face-section">
        <div className="face-switch">morning · pick your three</div>
        <h2>what will you touch today?</h2>
        <div className="priorities">
          {priorities.map((p, i) => (
            <input
              key={i}
              className="priority-input"
              value={p}
              onChange={(e) => setPriority(i, e.target.value)}
              placeholder={`priority ${i + 1}`}
            />
          ))}
        </div>
        {today.caught.carried.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div className="small" style={{ marginBottom: 8 }}>carried from before</div>
            {today.caught.carried.map((it) => (
              <div key={it.id} style={{ fontSize: 15, padding: "4px 0", color: "var(--ink-soft)" }}>
                · {it.text}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="primary" onClick={savePriorities}>hold these</button>
          <a href={today.journal.today_deeplink}>open today's journal in heptabase →</a>
        </div>
      </div>
    );
  }

  const closedToday = today.caught.items.filter(
    (i) => i.closed_date === today.date,
  );
  const carrying = today.caught.carried;

  return (
    <div className="face-section">
      <div className="face-switch">evening </div>

      <div style={{ marginTop: 16 }}>
        <div className="small">closed today</div>
        {closedToday.length === 0 ? (
          <div className="quiet" style={{ padding: "6px 0" }}>
            nothing marked closed.
          </div>
        ) : (
          closedToday.map((it) => (
            <div key={it.id} style={{ fontSize: 15, padding: "4px 0" }}>
              ✓ {it.text}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="small">carries forward</div>
        {carrying.length === 0 ? (
          <div className="quiet" style={{ padding: "6px 0" }}>
            nothing carried.
          </div>
        ) : (
          carrying.map((it) => (
            <div key={it.id} style={{ fontSize: 15, padding: "4px 0", color: "var(--ink-soft)" }}>
              → {it.text}
            </div>
          ))
        )}
      </div>

      {today.reflection_prompt && (
        <>
          <div className="reflection">{today.reflection_prompt}</div>
          <textarea
            className="reflection-input"
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder={
              settings.voice.reflection_style === "direct"
                ? "say it plainly."
                : "one honest sentence."
            }
          />
          <div style={{ marginTop: 12 }}>
            <a href={today.journal.today_deeplink}>write in heptabase →</a>
          </div>
        </>
      )}
    </div>
  );
}
