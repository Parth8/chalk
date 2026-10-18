// Shared games: keeping this phone and the Worker in step.
//
// What you see is always the Worker's game plus your own moves that haven't been confirmed yet
// (the outbox), so taps show at once. The outbox sends one move at a time, in order. Without
// signal (or while the Worker is busy), moves wait in the outbox, kept on the phone so even a
// reload doesn't lose them, and go as soon as they can. Each move remembers the game it was made
// on; if the Worker's game has moved on in a way that doesn't match, the waiting moves are
// dropped and the Worker's game is shown, rather than guessing.
//
// Every request belongs to one opening of one game (online.run). A reply that arrives after you
// left that game is ignored, so it can never land on whatever you opened next.

import { api, isOffline, seatFor, keepSeat, forgetSeat } from "./api.js";
import { session, changed } from "./session.js";
import { applyMove } from "./match.js";
import * as store from "./store.js";
import { toast } from "./dom.js";

const POLL_MS = 2500;
const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

const fresh = () => ({ id: null, v: 0, token: null, game: null, down: false, outbox: [], sending: false, polling: false, timer: null, retry: null, tries: 0 });
export const online = { ...fresh(), run: 0 };

/** The Worker's game as a match. */
export function serverMatch(g = online.game) {
  const m = { game: g.kind === "pool" ? "pool" : "snooker", players: g.players, frames: g.frames };
  if (m.game === "snooker") m.reds = g.reds;
  if (g.target) m.target = g.target;
  if (g.teams && g.teams.some((t) => t && t.length > 1)) m.teams = g.teams.map((t) => t || []);
  return m;
}

/** Where a match is up to: how many games, how many moves in the last one. */
const shape = (m) => `${m.frames.length}:${m.frames[m.frames.length - 1].events.length}`;

/** Both sides are in and the first game has started. */
export const started = () => !!online.game && !online.game.players.includes(null) && online.game.frames.length > 0;

/** For the header: "live", "watching live", "offline · 2 waiting to send", "sending…". */
export function status() {
  const waiting = online.outbox.length;
  if (online.down) return waiting ? `offline · ${waiting} waiting to send` : "reconnecting…";
  if (waiting) return "sending…";
  return session.seat === null ? "watching live" : "live";
}

/** Is this reply still for the game on screen? */
const current = (run) => run === online.run && session.mode === "online" && session.id === online.id;

function rebuild() {
  if (!online.game || session.id !== online.id) return;
  let m = serverMatch();
  for (const item of online.outbox) {
    try {
      m = applyMove(m, item.e, session.seat);
    } catch {
      break; // shown up to the first move that no longer fits; flush() sorts it out
    }
  }
  session.match = m;
  session.ready = started();
  changed();
}

function saveOutbox() {
  if (online.outbox.length) store.write(store.KEYS.outbox + online.id, online.outbox);
  else store.remove(store.KEYS.outbox + online.id);
}

/** Take the Worker's game, unless it's older than what we already have. */
function applyServer(r) {
  if (!r || r.same || r.v < online.v) return;
  online.v = r.v;
  online.game = r.game;
  store.write(store.KEYS.view + online.id, { v: r.v, game: r.game }); // to open it again with no signal
  if (session.seat !== null) keepSeat(online.id, session.seat, online.token, r.game.players, r.game.kind);
  rebuild();
}

/* ---------------- opening, joining, leaving ---------------- */

export async function create(opts) {
  const r = await api.create(opts);
  return r.id;
}

/** Open a shared game: as a player if this phone has a seat in it, otherwise to join or watch. */
export async function open(id) {
  close();
  const run = online.run;
  online.id = id;
  const mine = seatFor(id);
  online.token = mine ? mine.token : null;
  online.outbox = mine ? store.read(store.KEYS.outbox + id, []) : [];
  Object.assign(session, { mode: "online", id, match: null, seat: mine ? mine.seat : null, ready: false, send });
  let r;
  try {
    r = await api.get(id);
  } catch (err) {
    // no signal: show the game as this phone last saw it, and catch up when the signal's back
    const saved = isOffline(err) && store.read(store.KEYS.view + id);
    if (!saved) throw err;
    r = saved;
    online.down = true;
  }
  if (!current(run)) return;
  applyServer(r);
  startPolling();
  flush();
}

/** Take a seat: a name, and for doubles the whole team. */
export async function join(name, team) {
  const run = online.run;
  const r = await api.join(online.id, name, team);
  if (!current(run)) return r;
  online.token = r.token;
  session.seat = r.seat;
  keepSeat(online.id, r.seat, r.token, r.game.players, r.game.kind);
  applyServer(r);
  return r;
}

export function close() {
  clearTimeout(online.timer);
  clearTimeout(online.retry);
  Object.assign(online, fresh(), { run: online.run + 1 });
}

/* ---------------- sending moves ---------------- */

function send(e) {
  let next;
  try {
    next = applyMove(session.match, e, session.seat);
  } catch {
    toast("That doesn't fit the game right now");
    return;
  }
  online.outbox.push({ e, base: shape(session.match), after: shape(next) });
  saveOutbox();
  session.match = next;
  changed();
  flush();
}

/** The same move, whatever order its fields were written in. */
const sameMove = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

/** Did a move we sent reach the Worker even though we never heard back? */
function alreadyThere(item) {
  const m = serverMatch();
  if (shape(m) !== item.after || item.after === item.base) return false;
  if (["undo", "next", "restart"].includes(item.e.t)) return true; // the game is now where that move would have taken it
  const events = m.frames[m.frames.length - 1].events;
  return sameMove(events[events.length - 1], { ...item.e, by: session.seat });
}

function drop(message) {
  online.outbox = [];
  saveOutbox();
  toast(message);
}

/** Worth trying again later: no signal, the Worker busy (rate limit) or having a moment (5xx). */
const retryable = (err) => isOffline(err) || err.status === 429 || err.status >= 500;

async function flush() {
  if (online.sending || !online.outbox.length || !online.id) return;
  online.sending = true;
  const run = online.run;
  try {
    while (online.outbox.length && current(run)) {
      const item = online.outbox[0];
      if (shape(serverMatch()) !== item.base) {
        if (alreadyThere(item)) {
          online.outbox.shift();
          saveOutbox();
          continue;
        }
        drop("The other phone changed something first. Have another look.");
        break;
      }
      try {
        const r = await api.act(online.id, online.token, online.v, item.e);
        if (!current(run)) return;
        online.outbox.shift();
        saveOutbox();
        applyServer(r);
        online.down = false;
        online.tries = 0;
      } catch (err) {
        if (!current(run)) return;
        if (retryable(err)) {
          online.down = true;
          retryLater();
          break;
        }
        if (err.code === "stale") {
          // someone moved first: look at the game now (maybe it was our own move that landed)
          try {
            applyServer(err.data && err.data.game ? err.data : await api.get(online.id));
          } catch {
            online.down = true;
            retryLater();
            break;
          }
          if (!current(run)) return;
          continue;
        }
        if (err.code === "no_seat") {
          // this phone's seat key no longer works: carry on as a watcher
          forgetSeat(online.id);
          session.seat = null;
          drop("This phone isn't one of the players in this game any more. You can still watch.");
          break;
        }
        drop(err.message);
        try {
          applyServer(await api.get(online.id));
        } catch {}
        break;
      }
    }
  } finally {
    if (run === online.run) {
      online.sending = false;
      rebuild();
    }
  }
}

function retryLater() {
  clearTimeout(online.retry);
  const wait = RETRY_MS[Math.min(online.tries++, RETRY_MS.length - 1)];
  online.retry = setTimeout(flush, wait);
}

/* ---------------- staying up to date ---------------- */

function startPolling() {
  clearTimeout(online.timer);
  const run = online.run;
  const tick = async () => {
    if (!current(run)) return;
    try {
      if (document.visibilityState === "visible") await refresh();
    } finally {
      if (current(run)) online.timer = setTimeout(tick, POLL_MS);
    }
  };
  online.timer = setTimeout(tick, POLL_MS);
}

/** Check for the other phone's moves (or send ours first, if any are waiting). One check at a time. */
export async function refresh() {
  if (!online.id) return;
  if (online.outbox.length) return flush();
  if (online.sending || online.polling) return;
  const run = online.run;
  online.polling = true;
  try {
    const r = await api.get(online.id, online.v);
    if (!current(run)) return;
    if (online.down) {
      online.down = false;
      changed();
    }
    if (!online.outbox.length && !online.sending) applyServer(r);
  } catch {
    if (current(run) && !online.down) {
      online.down = true;
      changed();
    }
  } finally {
    if (run === online.run) online.polling = false;
  }
}

window.addEventListener("online", () => {
  online.tries = 0;
  refresh();
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
