import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@life-console/shared";
import { api } from "./api.js";
import { Link, useRoute } from "./router.js";
import { MainPage } from "./pages/MainPage.js";
import { Opt1Page } from "./pages/Opt1Page.js";
import { Opt2Page } from "./pages/Opt2Page.js";
import { Opt3Page } from "./pages/Opt3Page.js";
import { SettingsPanel } from "./components/SettingsPanel.js";

const NAV = [
  { path: "/", label: "main" },
  { path: "/opt1", label: "opt1 · widgets" },
  { path: "/opt2", label: "opt2 · keep + track" },
  { path: "/opt3", label: "opt3 · workboard" },
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

  const pageClass =
    path === "/opt1"
      ? "app app-opt1"
      : path === "/opt2"
        ? "app app-opt2"
        : path === "/opt3"
          ? "app app-opt3"
          : "app";

  return (
    <div className={pageClass}>
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

      {path === "/opt1" ? (
        <Opt1Page />
      ) : path === "/opt2" ? (
        <Opt2Page />
      ) : path === "/opt3" ? (
        <Opt3Page />
      ) : path === "/settings" ? (
        settings ? (
          <SettingsPanel settings={settings} onSaved={setSettings} />
        ) : (
          <div className="quiet">loading…</div>
        )
      ) : (
        <MainPage />
      )}

      <footer className="footer">
        {path === "/" ? "main" : path.replace("/", "")}
      </footer>
    </div>
  );
}
