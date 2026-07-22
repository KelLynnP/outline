// 12-hour display formatting, shared by the day/week calendars.

const pad = (n: number) => String(n).padStart(2, "0");

/** "7a", "12p", "9p" for hour gutters. */
export function h12(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return "12a";
  if (hh < 12) return `${hh}a`;
  if (hh === 12) return "12p";
  return `${hh - 12}p`;
}

/** "13:30" → "1:30p" for block chips / labels. */
export function fmt12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const base = h12(h);
  if (!m) return base;
  return `${base.slice(0, -1)}:${pad(m)}${base.slice(-1)}`;
}
