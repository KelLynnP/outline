import { useState } from "react";

/** Boolean UI toggle persisted to localStorage. */
export function useToggle(key: string, initial: boolean) {
  const [on, setOn] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? initial : v === "1";
  });
  const toggle = () => {
    setOn((o) => {
      localStorage.setItem(key, o ? "0" : "1");
      return !o;
    });
  };
  return [on, toggle] as const;
}
