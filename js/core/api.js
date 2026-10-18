// Client for the shared-games Worker: a timeout, friendly errors, nothing else.

import * as store from "./store.js";

const BASE = (document.querySelector('meta[name="api-base"]')?.content || "").replace(/\/$/, "");
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(code, message, status = 0, data = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/** True when the request never got an answer (no signal, timeout): worth trying again later. */
export const isOffline = (err) => err instanceof ApiError && err.code === "offline";

async function call(path, body) {
  if (!BASE) throw new ApiError("not_configured", "Shared games aren't set up on this copy.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError("offline", navigator.onLine === false ? "You're offline." : "Couldn't reach the scoreboard. Check your signal.");
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(data.error || "server_error", data.message || "Something went wrong. Try again.", res.status, data);
  return data;
}

export const api = {
  /** { game: "snooker" | "pool", reds, target } */
  create: ({ game, reds, target }) => call("/api/games", game === "pool" ? { game, target } : { reds, target }),
  get: (id, v) => call(`/api/games/${id}${v ? `?v=${v}` : ""}`),
  /** team: everyone playing on this side, including the name typed (doubles) */
  join: (id, name, team) => call(`/api/games/${id}/join`, team && team.length > 1 ? { name, team } : { name }),
  act: (id, token, v, e) => call(`/api/games/${id}/act`, { token, v, e }),
};

/* Seat keys for the games you've joined, kept only on this phone. */
export const seats = () => {
  const all = store.read(store.KEYS.seats, {});
  return all && typeof all === "object" ? all : {};
};

export function seatFor(id) {
  const s = seats()[id];
  return s && (s.seat === 0 || s.seat === 1) && typeof s.token === "string" ? s : null;
}

export function forgetSeat(id) {
  const all = seats();
  delete all[id];
  store.write(store.KEYS.seats, all);
  store.remove(store.KEYS.outbox + id);
  store.remove(store.KEYS.view + id);
}

export function keepSeat(id, seat, token, names, kind) {
  const all = seats();
  all[id] = { seat, token, names, kind, at: Date.now() };
  const recent = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 12);
  store.write(store.KEYS.seats, Object.fromEntries(recent));
}
