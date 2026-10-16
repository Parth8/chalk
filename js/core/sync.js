// Shared games: keeping this phone and the Worker in step.
//
// What you see is always the Worker's game plus your own moves that haven't been confirmed yet
// (the outbox), so taps show at once. The outbox sends one move at a time, in order. Without
// signal, moves wait in the outbox (kept on the phone, so even a reload doesn't lose them) and
// go as soon as the connection is back. Each move remembers the game it was made on; if the
// Worker's game has moved on in a way that doesn't match, the waiting moves are dropped and the
// Worker's game is shown, rather than guessing.

import { api, isOffline, seatFor, keepSeat } from "./api.js";
import { session, changed } from "./session.js";
import { applyMove } from "./match.js";
import * as store from "./store.js";
import { toast } from "./dom.js";

const POLL_MS = 2500;
const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

export const online = { id: null, v: 0, token: null, game: null, down: false, outbox: [], sending: false, timer: null, retry: null, tries: 0, watch: false };

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

/** For the header: "live", "watching live", "offline · 2 waiting", "sending…". */
export function status() {
  const waiting = online.outbox.length;
  if (online.down) return waiting ? `offline · ${waiting} waiting to send` : "reconnecting…";
  if (waiting) return "sending…";
  return session.seat === null ? "watching live" : "live";
}

function rebuild() {
  if (!online.game) return;
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

function applyServer(r) {
  if (!r || r.same) return;
  online.v = r.v;
  online.game = r.game;
  if (session.seat !== null) keepSeat(online.id, session.seat, online.token, r.game.players);
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
  online.id = id;
  const mine = seatFor(id);
  online.token = mine ? mine.token : null;
  online.outbox = mine ? store.read(store.KEYS.outbox + id, []) : [];
  Object.assign(session, { mode: "online", id, match: null, seat: mine ? mine.seat : null, ready: false, send });
  applyServer(await api.get(id));
  startPolling();
  flush();
}

/** Take a seat: a name, and for doubles the whole team. */
export async function join(name, team) {
  const r = await api.join(online.id, name, team);
  online.token = r.token;
  session.seat = r.seat;
  keepSeat(online.id, r.seat, r.token, r.game.players);
  applyServer(r);
  return r;
}

export function close() {
  clearTimeout(online.timer);
  clearTimeout(online.retry);
  Object.assign(online, { id: null, v: 0, token: null, game: null, down: false, outbox: [], sending: false, timer: null, retry: null, tries: 0, watch: false });
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

/** Did a move we sent reach the Worker even though we never heard back? */
function alreadyThere(item) {
  const m = serverMatch();
  if (shape(m) !== item.after || item.after === item.base) return false;
  if (["undo", "next"].includes(item.e.t)) return true; // the game is now where that move would have taken it
  const events = m.frames[m.frames.length - 1].events;
  return JSON.stringify(events[events.length - 1]) === JSON.stringify({ ...item.e, by: session.seat });
}

function drop(message) {
  online.outbox = [];
  saveOutbox();
  toast(message);
}

async function flush() {
  if (online.sending || !online.outbox.length || !online.id) return;
  online.sending = true;
  const id = online.id;
  try {
    while (online.outbox.length && online.id === id) {
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
        const r = await api.act(id, online.token, online.v, item.e);
        if (online.id !== id) return;
        online.v = r.v;
        online.game = r.game;
        online.outbox.shift();
        saveOutbox();
        online.down = false;
        online.tries = 0;
      } catch (err) {
        if (online.id !== id) return;
        if (isOffline(err)) {
          online.down = true;
          retryLater();
          break;
        }
        if (err.code === "stale" && err.data && err.data.game) {
          online.v = err.data.v;
          online.game = err.data.game;
          continue; // look again: maybe it's our own move that landed
        }
        drop(err.message);
        try {
          applyServer(await api.get(id));
        } catch {}
        break;
      }
    }
  } finally {
    online.sending = false;
    if (online.id === id) rebuild();
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
  const tick = async () => {
    if (!online.id) return;
    if (document.visibilityState === "visible") await refresh();
    online.timer = setTimeout(tick, POLL_MS);
  };
  online.timer = setTimeout(tick, POLL_MS);
}

/** Check for the other phone's moves (or send ours first, if any are waiting). */
export async function refresh() {
  if (!online.id) return;
  if (online.outbox.length) return flush();
  if (online.sending) return;
  try {
    const r = await api.get(online.id, online.v);
    if (online.down) {
      online.down = false;
      changed();
    }
    if (!online.outbox.length && !online.sending) applyServer(r);
  } catch {
    if (!online.down) {
      online.down = true;
      changed();
    }
  }
}

window.addEventListener("online", () => {
  online.tries = 0;
  refresh();
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
