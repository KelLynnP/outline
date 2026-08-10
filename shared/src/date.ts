export function localDateISO(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDateISO(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateISO(value);
}

export type WeekStart = "sunday" | "monday";

export function startOfWeekISO(
  date: string,
  startsOn: WeekStart = "sunday",
): string {
  const day = new Date(`${date}T12:00:00`).getDay();
  const firstDay = startsOn === "sunday" ? 0 : 1;
  return shiftDateISO(date, -((day - firstDay + 7) % 7));
}
