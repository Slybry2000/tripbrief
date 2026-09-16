// Pure date-range logic for the ticket-style calendar, kept out of the component
// so the two-click rule and the day counts can be tested on their own.
// Every date is a plain ISO day string (YYYY-MM-DD), which also sorts correctly.

export type Range = { start: string | null; end: string | null };

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function fromIso(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number) {
  const date = fromIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// Days between two dates, counted on the calendar rather than in milliseconds so
// a daylight-saving change cannot shift the answer.
export function daysBetween(start: string, end: string) {
  const from = fromIso(start).getTime();
  const to = fromIso(end).getTime();
  return Math.round((to - from) / 86_400_000);
}

// The airline rule. The first click starts the trip, the second one finishes it.
// A click before the start moves the start instead of producing an impossible
// range, and a click after a complete range starts a new one.
export function applyDateClick(range: Range, clicked: string): Range {
  if (!range.start || range.end) return { start: clicked, end: null };
  if (clicked < range.start) return { start: clicked, end: null };
  return { start: range.start, end: clicked };
}

export function rangeLabel(range: Range) {
  if (!range.start) return "Pick the arrival day";
  if (!range.end) return "Now pick the day the trip ends";
  const nights = daysBetween(range.start, range.end);
  if (nights === 0) return "Same day";
  return `${nights + 1} days, ${nights} ${nights === 1 ? "night" : "nights"}`;
}

export function isInRange(range: Range, iso: string) {
  if (!range.start) return false;
  if (!range.end) return iso === range.start;
  return iso >= range.start && iso <= range.end;
}

export function formatDay(iso: string) {
  return fromIso(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type DayCell = { iso: string; day: number; disabled: boolean };

// A month laid out in weeks, padded so the first day sits under its weekday.
// Days before today are disabled: an airline calendar never sells yesterday.
export function monthGrid(
  year: number,
  month: number,
  today: string,
): (DayCell | null)[][] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIso(new Date(Date.UTC(year, month, day)));
    cells.push({ iso, day, disabled: iso < today });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (DayCell | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7)
    weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function monthOf(iso: string) {
  const date = fromIso(iso);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function shiftMonth(year: number, month: number, by: number) {
  const date = new Date(Date.UTC(year, month + by, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}
