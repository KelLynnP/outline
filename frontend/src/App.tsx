import { useEffect, useState } from "react";
import { HomePage } from "./pages/HomePage.js";
import { MobilePage } from "./pages/MobilePage.js";

const MOBILE_QUERY = "(max-width: 640px)";

export function App() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (mobile) return <MobilePage />;

  return (
    <div className="app app-home">
      <header className="header">
        <h1>life console</h1>
      </header>
      <HomePage />
    </div>
  );
}
