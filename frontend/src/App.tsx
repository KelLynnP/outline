import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@life-console/shared";
import { api } from "./api.js";
import { Link, useRoute } from "./router.js";
import { Opt3Page } from "./pages/Opt3Page.js";
import { SettingsPanel } from "./components/SettingsPanel.js";

const NAV = [
  { path: "/", label: "workboard" },
  { path: "/settings", label: "settings" },
];

export function App() {
  const [path, navigate] = useRoute();
  const [settings, setSettings] = useState<Settings | null>(null);

  const loadSettings = useCallback(async () => {
    setSettings(await api.settings());
  }, []);
  useEffect(() => {
    loadSettings().catch(console.error);
  }, [loadSettings]);

  return (
    <div className="app app-opt3">
      <header className="header">
        <h1>life console</h1>
        <nav>
          {NAV.map((n) => (
            <Link
              key={n.path}
              to={n.path}
              className={path === n.path ? "nav-link active" : "nav-link"}
              onNavigate={navigate}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      {path === "/settings" ? (
        settings ? (
          <SettingsPanel settings={settings} onSaved={setSettings} />
        ) : (
          <div className="quiet">loading…</div>
        )
      ) : (
        <Opt3Page />
      )}

      <footer className="footer">
        {path === "/settings" ? "settings" : "workboard"}
      </footer>
    </div>
  );
}
