import type { IsoDate } from "@second-half/contracts";

const DAY_MS = 864e5;

/** The calendar date on the device, in its own time zone. The only place the app reads the clock is the caller. */
export function localIsoDate(now: Date): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: IsoDate): number => new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();

/** The Sunday that ends the Monday–Sunday week `date` falls in. */
export const sundayOnOrAfter = (date: IsoDate): IsoDate => addDays(date, (7 - weekday(date)) % 7);

export const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

/** "Thu 26 Nov". */
export function shortDate(date: IsoDate): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
