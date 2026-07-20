import { useState } from "react";
import type { Settings } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  settings: Settings;
  onSaved: (s: Settings) => void;
}

export function SettingsPanel({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  const save = async () => {
    const next = await api.saveSettings(draft);
    onSaved(next);
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div>
      <div style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.01em" }}>
        settings
      </div>
      <div className="quiet" style={{ fontSize: 12, marginBottom: 32 }}>
        one surface. edits write to <code>settings.json</code>.
      </div>

      <div className="settings">
        <h3>sections</h3>
        {(Object.keys(draft.sections) as (keyof Settings["sections"])[]).map((k) => (
          <Row key={k} label={k}>
            <Toggle
              checked={draft.sections[k]}
              onChange={(v) => set("sections", { ...draft.sections, [k]: v })}
            />
          </Row>
        ))}

        <h3>line</h3>
        <Row label="recent stops">
          <input
            type="number"
            value={draft.line.recent_stops}
            onChange={(e) =>
              set("line", { ...draft.line, recent_stops: Number(e.target.value) })
            }
          />
        </Row>
        <Row label="months visible">
          <input
            type="number"
            value={draft.line.months_visible}
            onChange={(e) =>
              set("line", { ...draft.line, months_visible: Number(e.target.value) })
            }
          />
        </Row>
        <Row label="color mode">
          <select
            value={draft.line.month_color_mode}
            onChange={(e) =>
              set("line", {
                ...draft.line,
                month_color_mode: e.target.value as "fixed" | "derived",
              })
            }
          >
            <option value="fixed">fixed hues</option>
            <option value="derived">derived (v2)</option>
          </select>
        </Row>

        <h3>body</h3>
        <Row label="meal alert (hours)">
          <input
            type="number"
            value={draft.body.meal_alert_hours}
            onChange={(e) =>
              set("body", { ...draft.body, meal_alert_hours: Number(e.target.value) })
            }
          />
        </Row>
        {(Object.keys(draft.body.tracked) as (keyof Settings["body"]["tracked"])[]).map((k) => (
          <Row key={k} label={`track ${k}`}>
            <Toggle
              checked={draft.body.tracked[k]}
              onChange={(v) =>
                set("body", {
                  ...draft.body,
                  tracked: { ...draft.body.tracked, [k]: v },
                })
              }
            />
          </Row>
        ))}

        <h3>tags</h3>
        <Row label="normal">
          <input
            type="text"
            value={draft.tags.normal}
            onChange={(e) => set("tags", { ...draft.tags, normal: e.target.value })}
          />
        </Row>
        <Row label="urgent">
          <input
            type="text"
            value={draft.tags.urgent}
            onChange={(e) => set("tags", { ...draft.tags, urgent: e.target.value })}
          />
        </Row>
        <Row label="question">
          <input
            type="text"
            value={draft.tags.question}
            onChange={(e) => set("tags", { ...draft.tags, question: e.target.value })}
          />
        </Row>

        <h3>voice</h3>
        <Row label="morning starts (hour)">
          <input
            type="number"
            value={draft.voice.morning_start_hour}
            onChange={(e) =>
              set("voice", { ...draft.voice, morning_start_hour: Number(e.target.value) })
            }
          />
        </Row>
        <Row label="evening starts (hour)">
          <input
            type="number"
            value={draft.voice.evening_start_hour}
            onChange={(e) =>
              set("voice", { ...draft.voice, evening_start_hour: Number(e.target.value) })
            }
          />
        </Row>
        <Row label="reflection style">
          <select
            value={draft.voice.reflection_style}
            onChange={(e) =>
              set("voice", {
                ...draft.voice,
                reflection_style: e.target.value as "gentle" | "direct",
              })
            }
          >
            <option value="gentle">gentle</option>
            <option value="direct">direct</option>
          </select>
        </Row>

        <h3>sources</h3>
        {(Object.keys(draft.sources) as (keyof Settings["sources"])[]).map((k) => (
          <Row key={k} label={k}>
            <Toggle
              checked={draft.sources[k]}
              onChange={(v) => set("sources", { ...draft.sources, [k]: v })}
            />
            {k !== "heptabase" && (
              <span className="quiet" style={{ fontSize: 11, marginLeft: 12 }}>
                stub — no data yet
              </span>
            )}
          </Row>
        ))}
      </div>

      <div style={{ marginTop: 32 }}>
        <button className="primary" onClick={save}>save</button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <label>{label.replace(/_/g, " ")}</label>
      <div className="toggle">{children}</div>
    </>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        background: checked ? "var(--ink)" : "transparent",
        color: checked ? "var(--bg)" : "var(--ink-soft)",
        borderColor: checked ? "var(--ink)" : "var(--line)",
        padding: "3px 12px",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {checked ? "on" : "off"}
    </button>
  );
}
