import { useCallback, useEffect, useState } from "react";
import type { LineView, Settings, TodayView } from "@life-console/shared";
import { api } from "../api.js";
import { TrainLine } from "../components/TrainLine.js";
import { TodayPanel } from "../components/TodayPanel.js";
import { Face } from "../components/Face.js";

export function MainPage() {
  const [line, setLine] = useState<LineView | null>(null);
  const [today, setToday] = useState<TodayView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    const [l, t, s] = await Promise.all([api.line(), api.today(), api.settings()]);
    setLine(l);
    setToday(t);
    setSettings(s);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  if (!line || !today || !settings) return <div className="quiet">gathering…</div>;

  return (
    <>
      <div className="direction">
        <span className="quiet-tag">direction</span>
        {today.direction?.sentence ?? (
          <span className="quiet">
            no sentence yet — enable heptabase in settings for weekly synthesis.
          </span>
        )}
      </div>

      <TrainLine line={line} />
      <TodayPanel today={today} settings={settings} onChange={load} />
      <Face today={today} settings={settings} onChange={load} />
    </>
  );
}
