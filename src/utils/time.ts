import { addMinutes, isBefore, isAfter, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime, format as formatTz } from "date-fns-tz";

/**
 * Convert HH:MM string to minutes from midnight (for internal calculations)
 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/**
 * Convert minutes from midnight to HH:MM string
 */
export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Check if two time ranges overlap
 */
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

/**
 * Check if a reservation time (UTC) falls within operating hours
 * Operating hours are stored as local time strings (HH:MM)
 *
 * @param start - Reservation start time in UTC
 * @param durationMinutes - Reservation duration in minutes
 * @param openingTime - Restaurant opening time in local HH:MM format
 * @param closingTime - Restaurant closing time in local HH:MM format
 * @param timezone - Restaurant's IANA timezone (e.g., "America/New_York")
 */
export function withinOperatingHours(
  start: Date,
  durationMinutes: number,
  openingTime: string,
  closingTime: string,
  timezone: string,
): boolean {
  // Convert UTC time to restaurant's local time
  const localStart = toZonedTime(start, timezone);
  const localEnd = addMinutes(localStart, durationMinutes);

  // Get the local time as minutes from midnight
  const startMinutes = localStart.getHours() * 60 + localStart.getMinutes();
  const endMinutes = localEnd.getHours() * 60 + localEnd.getMinutes();

  const openingMinutes = hhmmToMinutes(openingTime);
  const closingMinutes = hhmmToMinutes(closingTime);

  // Handle case where reservation spans midnight
  if (endMinutes < startMinutes) {
    // Reservation spans midnight - not allowed
    return false;
  }

  return startMinutes >= openingMinutes && endMinutes <= closingMinutes;
}

/**
 * Get the local time string (HH:MM) from a UTC Date in a specific timezone
 */
export function getLocalTimeString(utcDate: Date, timezone: string): string {
  const localDate = toZonedTime(utcDate, timezone);
  return formatTz(localDate, "HH:mm", { timeZone: timezone });
}

/**
 * Get local time as minutes from midnight for a UTC date in a specific timezone
 */
export function getLocalMinutes(utcDate: Date, timezone: string): number {
  const localDate = toZonedTime(utcDate, timezone);
  return localDate.getHours() * 60 + localDate.getMinutes();
}

/**
 * Create a UTC Date from a local date string and time string
 *
 * @param dateStr - Date in YYYY-MM-DD format
 * @param timeStr - Time in HH:MM format (local time)
 * @param timezone - IANA timezone (e.g., "America/New_York")
 * @returns UTC Date object
 */
export function localToUtc(
  dateStr: string,
  timeStr: string,
  timezone: string,
): Date {
  const [year, month, day] = dateStr.split("-").map((x) => parseInt(x, 10));
  const [hours, minutes] = timeStr.split(":").map((x) => parseInt(x, 10));

  // Create a date object representing local time in that timezone
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

  // Convert from that timezone to UTC
  return fromZonedTime(localDate, timezone);
}

/**
 * Get the day of week in the restaurant's local timezone
 */
export function getLocalDayOfWeek(utcDate: Date, timezone: string): number {
  const localDate = toZonedTime(utcDate, timezone);
  return localDate.getDay();
}

/**
 * Validate that a time string is in HH:MM format
 */
export function isValidTimeFormat(time: string): boolean {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(time);
}

/**
 * Validate that a timezone is a valid IANA timezone
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare two HH:MM time strings
 * Returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareTimeStrings(a: string, b: string): number {
  return hhmmToMinutes(a) - hhmmToMinutes(b);
}

/**
 * Check if a time string falls within a range (inclusive start, exclusive end)
 */
export function isTimeInRange(
  time: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  const timeMinutes = hhmmToMinutes(time);
  const startMinutes = hhmmToMinutes(rangeStart);
  const endMinutes = hhmmToMinutes(rangeEnd);

  return timeMinutes >= startMinutes && timeMinutes < endMinutes;
}

export function parseDateTime(dateTime: string): Date {
  return parseISO(dateTime);
}
