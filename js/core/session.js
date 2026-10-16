// The match being played on this phone right now, and the one way to change it: act(move).
// On one phone, moves apply straight away and are saved. In a shared game, sync.js plugs in a
// sender (session.send) that shows the move at once and delivers it to the Worker.
// Screens subscribe with onChange() and redraw from state().

import { applyMove, engineOf, gameOf, replay, sideNames, matchWinner } from "./match.js";
import * as store from "./store.js";

export const session = {
  mode: null, // "local" | "online" | null (home screens)
  id: null, // shared games: the game's id
  match: null,
  seat: null, // shared games: this phone's side (0 or 1), or null when watching
  ready: false, // shared games: both sides have joined
  send: null, // shared games: (move) => void, set by sync.js
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const changed = () => listeners.forEach((fn) => fn());

export const state = () => replay(session.match);
export const names = () => sideNames(session.match);
export const frameNo = () => session.match.frames.length;
export const eventsNow = () => session.match.frames[session.match.frames.length - 1].events;
/** Changes whenever a move is made or taken back: keys pop-ups to the moment they belong to. */
export const evKey = () => `${frameNo()}:${eventsNow().length}`;
/**
 * Changes with each new game and each restart: keys "set up the table" to the game it's for.
 * A match on this phone counts as new each time it's opened (a new match, or carrying on later).
 */
let opened = 0;
export const gameKey = () => `${session.mode}:${session.id || opened}:${frameNo()}:${session.match.frames[frameNo() - 1].restarts || 0}`;
export const isShared = () => session.mode === "online";

/**
 * May this phone do this now?
 *   turn     play a shot (pot, miss, foul, call, choose…)
 *   toss     settle a coin toss (snooker's re-spotted black)
 *   next     start the next game
 *   concede  give up the current game
 *   undo     take back the last move (in a shared game, only your own)
 */
export function can(what, s = state()) {
  const ev = eventsNow();
  const matchOver = matchWinner(session.match) !== null;
  const rules = {
    turn: engineOf(session.match).playable(s),
    toss: !!s.toss,
    next: s.over && !matchOver,
    concede: !s.over,
    undo: ev.length > 0 || (!isShared() && session.match.frames.length > 1),
  }[what];
  if (!rules || !isShared()) return !!rules;
  if (session.seat === null || !session.ready) return false;
  if (what === "turn") return s.turn === session.seat;
  if (what === "undo") return ev[ev.length - 1]?.by === session.seat;
  return true;
}

/** Make a move. Returns false if it doesn't fit the game (nothing changes). */
export function act(e) {
  if (isShared()) {
    session.send(e);
    return true;
  }
  try {
    session.match = applyMove(session.match, e);
  } catch {
    return false;
  }
  saveLocal();
  changed();
  return true;
}

/* ---------------- this phone ---------------- */

export function openLocal(m) {
  opened++;
  Object.assign(session, { mode: "local", id: null, match: m, seat: null, ready: true, send: null });
  saveLocal();
  changed();
}

export function saveLocal() {
  if (session.mode === "local") store.write(store.KEYS.local[gameOf(session.match)], session.match);
}

/** The saved match for a game on this phone, if there is one and it still replays. */
export function loadLocal(game) {
  const m = store.read(store.KEYS.local[game]);
  if (!m || !Array.isArray(m.frames) || !m.frames.length || gameOf(m) !== game) return null;
  try {
    replay(m);
    return m;
  } catch {
    return null;
  }
}

export const deleteLocal = (game) => store.remove(store.KEYS.local[game]);

/** Restart the current game (scores back to 0), or the whole match. This phone only. */
export function restartLocal(all = false) {
  const m = structuredClone(session.match);
  // `restarts` tells screens it's a fresh start (the balls need setting up again)
  if (all) m.frames = [{ breaker: m.frames[0].breaker, events: [], restarts: (m.frames[0].restarts || 0) + 1 }];
  else {
    const f = m.frames[m.frames.length - 1];
    f.events = [];
    f.restarts = (f.restarts || 0) + 1;
  }
  session.match = m;
  saveLocal();
  changed();
}

export function leave() {
  Object.assign(session, { mode: null, id: null, match: null, seat: null, ready: false, send: null });
}
