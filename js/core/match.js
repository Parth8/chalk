// A match: one or more games between two sides, whichever game it is. The rules of each game
// live in its own engine; this file only knows what every game shares:
//   { game: "snooker" | "pool", players: [side name, side name], frames: [{ breaker, events }],
//     reds?: 15 | 10 | 6 (snooker), target?: games needed to win the match, teams?: [[names], [names]] }
// Pure functions only. Tested in tests/match.test.mjs.

import * as snooker from "../snooker/engine.js";
import * as pool from "../pool/engine.js";

export const ENGINES = { snooker, pool };
export const gameOf = (m) => (m && m.game === "pool" ? "pool" : "snooker");
export const engineOf = (m) => ENGINES[gameOf(m)];

/** Match lengths on offer: games needed to win (0 = play as many as you like). */
export const TARGETS = [0, 2, 3, 4];
export const targetWords = (t) => (t ? `best of ${t * 2 - 1}` : "");

export function createMatch({ game, players, teams = null, target = 0, reds = 15, breaker = 0 }) {
  const m = { ...engineOf({ game }).newMatch({ players, reds, breaker }), game: gameOf({ game }) };
  if (game === "pool") delete m.reds;
  if (target) m.target = target;
  if (teams && teams.some((t) => t.length > 1)) m.teams = teams;
  return m;
}

export const replay = (m, i = m.frames.length - 1) => engineOf(m).replayFrame(m, i);
export const gamesWon = (m) => engineOf(m).framesWon(m);

/** The side that has won the match, or null (always null with no target). */
export function matchWinner(m) {
  if (!m.target) return null;
  const won = gamesWon(m);
  return won[0] >= m.target ? 0 : won[1] >= m.target ? 1 : null;
}

/** Games each side still needs, or null with no target. */
export function gamesNeeded(m) {
  if (!m.target) return null;
  return gamesWon(m).map((w) => Math.max(0, m.target - w));
}

export function nextGame(m) {
  if (matchWinner(m) !== null) throw new Error("the match is over");
  return engineOf(m).nextFrame(m);
}

/** Side names as shown: a team's name, or its players joined ("Asha & Ben"). */
export const sideName = (m, p) => m.players[p] || `Player ${p + 1}`;
export const sideNames = (m) => [0, 1].map((p) => sideName(m, p));

/** Up to 4 non-empty names, trimmed, for a team. */
export function cleanTeam(names) {
  return names
    .map((n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * How many visits each side has had in a game: the side that breaks starts with one, and every
 * time the table passes to a side it's a new visit. When the side coming in after a foul makes the
 * offender play again, that wasn't a visit for them (the same player carries on).
 */
export function visits(m, i = m.frames.length - 1) {
  const E = engineOf(m);
  const f = m.frames[i];
  let s = E.startFrame(m.reds, f.breaker);
  const count = [0, 0];
  count[s.turn] = 1;
  for (const e of f.events) {
    const before = s.turn;
    s = E.apply(s, e);
    if (s.turn === before) continue;
    // made to play again, or (pool) a choice that hands the break back: the same player carries on,
    // and the side that chose didn't have a visit
    if (e.t === "again" || e.t === "replace" || e.t === "choose") count[before]--;
    else count[s.turn]++;
  }
  return count;
}

/**
 * Who's at the table for a side: the side's name, or in a team the player whose turn it is.
 * Players take visits in order (A1, B1, A2, B2, …); each new game starts one player further on.
 * i can be one past the last game, for who will break the next one.
 */
export function playerUp(m, side, i = m.frames.length - 1) {
  const team = m.teams?.[side];
  if (!team || team.length < 2) return sideName(m, side);
  const n = i < m.frames.length ? Math.max(0, visits(m, i)[side] - 1) : 0; // i past the end: the next game
  return team[(i + n) % team.length];
}

/**
 * The one way a move changes a match, for this phone and (optimistically) for shared games.
 * Returns a new match; throws if the rules don't allow the move here.
 *   by: the seat that made it, stored with shared-game moves
 */
export function applyMove(m, e, by = null) {
  const next = structuredClone(m);
  const events = next.frames[next.frames.length - 1].events;
  if (e.t === "undo") {
    if (events.length) events.pop();
    else if (next.frames.length > 1 && by === null) next.frames.pop(); // on this phone, undo can step back into the last game
    return next;
  }
  if (e.t === "next") return nextGame(next);
  if (e.t === "restart" || e.t === "restart-no") return next; // shared games only: the Worker decides
  events.push(by === null ? e : { ...e, by });
  replay(next); // throws if the move doesn't fit
  return next;
}
