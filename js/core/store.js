// Everything this app keeps on the phone, in one place. Storage can be full, blocked or
// cleared at any time, so every read has a fallback and every write may quietly fail.
// (Some keys still say "snooker": they predate pool, and renaming them would lose saved games.)

export const KEYS = {
  game: "chalk.game", // "snooker" | "pool": the game picked on this phone
  local: { snooker: "snooker.local", pool: "chalk.pool.local" }, // the match on this phone, per game
  names: "snooker.names", // last names typed, to prefill the next game
  teams: "chalk.teams", // the same for doubles: { teams: [[a, b], [c, d]], teamNames }
  seats: "snooker.seats", // keys for shared games joined from this phone
  outbox: "chalk.outbox.", // + game id: moves waiting for signal
  view: "chalk.view.", // + game id: the shared game as this phone last saw it (to open with no signal)
  theme: "snooker.theme", // "light", or nothing for dark (read before first paint by theme.js)
  sound: "chalk.sound", // { clicks, voice }
  toured: "chalk.toured", // games whose walkthrough has been shown: { snooker: true }
};

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/** Plain strings, for keys that a non-module script reads too (the theme). */
export function readText(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeText(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
