import { addMinutes, isBefore, isAfter, parseISO } from "date-fns";

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function overlaps(
  aStart: Date,
  aDuration: number,
  bStart: Date,
  bDuration: number,
): boolean {
  const aEnd = addMinutes(aStart, aDuration);
  const bEnd = addMinutes(bStart, bDuration);
  return isBefore(aStart, bEnd) && isBefore(bStart, aEnd);
}

export function withinOperatingHours(
  start: Date,
  durationMinutes: number,
  openingMinutes: number,
  closingMinutes: number,
): boolean {
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = startMinutes + durationMinutes;
  return startMinutes >= openingMinutes && endMinutes <= closingMinutes;
}

export function parseDateTime(dateTime: string): Date {
  return parseISO(dateTime);
}
