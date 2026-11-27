import type { GameState, IsoDate } from "@second-half/contracts";

/**
 * What the app keeps between visits. The game state is the engine's; `date` is the day the app is on
 * (the device date, or later after the demo skips ahead) and `closedOn` is the last day checked in.
 */
export interface SavedGame {
  state: GameState;
  date: IsoDate;
  closedOn: IsoDate | null;
}

export const STORAGE_KEY = "second-half:game:v1";

/** The subset of the Web Storage API we use, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null where it is missing or blocked (private mode, SSR). */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = `${STORAGE_KEY}:probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const isDate = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Reads a saved game. Anything missing, unreadable or the wrong shape reads as no save. */
export function readSaved(store: KeyValueStore | null): SavedGame | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedGame>;
    const s = v.state as Partial<GameState> | undefined;
    const ok =
      !!s &&
      typeof s.userId === "string" &&
      Array.isArray(s.goals) &&
      Array.isArray(s.habits) &&
      s.habits.every((h) => Array.isArray(h.history)) &&
      typeof s.timezone === "string" &&
      !!s.character &&
      isDate(s.today) &&
      isDate(v.date) &&
      (v.closedOn === null || isDate(v.closedOn));
    return ok ? (v as SavedGame) : null;
  } catch {
    return null;
  }
}

/** Saves; a full or blocked store is not an error the player can act on, so it is swallowed. */
export function writeSaved(store: KeyValueStore | null, game: SavedGame): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(game));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved(store: KeyValueStore | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
