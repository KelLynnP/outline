import { useState } from "react";
import type { CaughtItem, Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  today: TodayView;
  settings: Settings;
  onChange: () => void;
}

type Section = "caught" | "body" | "journal" | null;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function timeSince(iso: string | null): string {
  const h = hoursSince(iso);
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function tagClass(tag: string, s: Settings): string {
  if (tag === s.tags.urgent) return "tag urgent";
  if (tag === s.tags.question) return "tag question";
  return "tag";
}

export function TodayPanel({ today, settings, onChange }: Props) {
  const [open, setOpen] = useState<Section>(null);
  const [newItem, setNewItem] = useState("");

  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const mealHours = today.body.hours_since_meal;
  const mealText =
    mealHours === null
      ? "no meals logged"
      : mealHours < 1
        ? "just ate"
        : `${Math.round(mealHours)}h since eating`;

  const addItem = async () => {
    if (!newItem.trim()) return;
    let tag = settings.tags.normal;
    let text = newItem.trim();
    if (text.startsWith(settings.tags.urgent)) {
      tag = settings.tags.urgent;
      text = text.replace(settings.tags.urgent, "").trim();
    } else if (text.startsWith(settings.tags.question)) {
      tag = settings.tags.question;
      text = text.replace(settings.tags.question, "").trim();
    }
    await api.addItem({ text, tag });
    setNewItem("");
    onChange();
  };

  return (
    <div className="today">
      {settings.sections.caught && (
        <>
          <div className="signal-row" onClick={() => toggle("caught")}>
            <span className="label">caught</span>
            <span className="value">
              {today.caught.items.length}
              {today.caught.urgent_count > 0 && <span className="dot" />}
            </span>
            <span className="quiet" style={{ marginLeft: "auto", fontSize: 12 }}>
              {open === "caught" ? "collapse" : "expand"}
            </span>
          </div>
          {open === "caught" && (
            <div className="signal-detail">
              {today.caught.items.length === 0 && (
                <div className="quiet">nothing caught.</div>
              )}
              {today.caught.items.map((it) => (
                <CaughtRow key={it.id} item={it} settings={settings} onChange={onChange} />
              ))}
              <div className="add-row">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder={`catch something ( ${settings.tags.urgent} for urgent )`}
                />
                <button onClick={addItem}>catch</button>
              </div>
            </div>
          )}
        </>
      )}

      {settings.sections.body && (
        <>
          <div className="signal-row" onClick={() => toggle("body")}>
            <span className="label">body</span>
            <span className="value">
              {mealText}
              {today.body.meal_alert && <span className="dot amber" />}
            </span>
            <span className="quiet" style={{ marginLeft: "auto", fontSize: 12 }}>
              {open === "body" ? "collapse" : "expand"}
            </span>
          </div>
          {open === "body" && (
            <>
              <div className="signal-detail">
                {settings.body.tracked.meals && (
                  <div className="row">
                    <span className="label" style={{ minWidth: 80 }}>meals</span>
                    <span className="text">{timeSince(today.body.signals.find((s) => s.type === "meal")?.timestamp ?? null)}</span>
                  </div>
                )}
                {settings.body.tracked.bike && (
                  <div className="row">
                    <span className="label" style={{ minWidth: 80 }}>bike</span>
                    <span className="text">{timeSince(today.body.last_bike)}</span>
                  </div>
                )}
                {settings.body.tracked.ocean && (
                  <div className="row">
                    <span className="label" style={{ minWidth: 80 }}>ocean</span>
                    <span className="text">{timeSince(today.body.last_ocean)}</span>
                  </div>
                )}
                {settings.body.tracked.sleep && (
                  <div className="row">
                    <span className="label" style={{ minWidth: 80 }}>sleep</span>
                    <span className="text">
                      {today.body.last_sleep_hours
                        ? `${today.body.last_sleep_hours}h`
                        : "—"}
                    </span>
                  </div>
                )}
              </div>
              <div className="body-quick">
                {settings.body.tracked.meals && (
                  <button onClick={async () => { await api.logSignal({ type: "meal" }); onChange(); }}>
                    log meal
                  </button>
                )}
                {settings.body.tracked.bike && (
                  <button onClick={async () => { await api.logSignal({ type: "bike" }); onChange(); }}>
                    log ride
                  </button>
                )}
                {settings.body.tracked.ocean && (
                  <button onClick={async () => { await api.logSignal({ type: "ocean" }); onChange(); }}>
                    log ocean
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {settings.sections.journal_excerpt && (
        <>
          <div className="signal-row" onClick={() => toggle("journal")}>
            <span className="label">journal</span>
            <span className="value">
              {today.journal.yesterday_excerpt
                ? "yesterday →"
                : "no entry yet"}
            </span>
            <a
              href={today.journal.today_deeplink}
              style={{ marginLeft: "auto", fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              open today →
            </a>
          </div>
          {open === "journal" && today.journal.yesterday_excerpt && (
            <div className="signal-detail">
              <div style={{ fontSize: 16, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {today.journal.yesterday_excerpt}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CaughtRow({
  item,
  settings,
  onChange,
}: {
  item: CaughtItem;
  settings: Settings;
  onChange: () => void;
}) {
  return (
    <div className="row">
      <span className={tagClass(item.tag, settings)}>{item.tag}</span>
      <span className="text" style={{ fontSize: 15 }}>{item.text}</span>
      <span className="quiet" style={{ fontSize: 11 }}>
        {new Date(item.captured_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </span>
      <span className="actions">
        <button onClick={async () => { await api.closeItem(item.id); onChange(); }}>
          close
        </button>
        {item.status !== "carried" && (
          <button onClick={async () => { await api.carryItem(item.id); onChange(); }}>
            carry
          </button>
        )}
      </span>
    </div>
  );
}
