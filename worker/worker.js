/**
 * Snooker: shared games. One small Worker, one D1 table.
 *
 * Anyone with a game's link can watch it live. Each side joins by typing a name (their own or a
 * team's) and gets a private seat key, kept on their phone. Every move is checked here with the
 * same rules engine the page uses, and it is only accepted from the side whose turn it is:
 *   pot, miss, foul           the player at the table
 *   play again, free ball,    the player coming in after a foul (it's their choice)
 *   foul & miss put back
 *   concede                   only for yourself
 *   undo                      only your own last move
 *   coin toss, next frame     either side
 *   restart frame / game      one side asks, the other side agrees (it wipes both scores)
 * So one side can never add to, or take away from, the other's score, and both see everything.
 *
 * Routes (JSON):
 *   GET  /api/health
 *   POST /api/games                  { reds }            → { id, v, game }
 *   GET  /api/games/<id>?v=<n>       → { v, game }, or { v, same: true } when nothing changed
 *   POST /api/games/<id>/join        { name }            → { seat, token, v, game }
 *   POST /api/games/<id>/act         { token, v, e }     → { v, game }
 *
 * Settings (Worker → Settings → Bindings / Variables):
 *   DB               D1 database binding. The table is created on first use.
 *   ALLOWED_ORIGINS  text   e.g. https://parth8.github.io   (comma separated, no path)
 *   REQUIRE_ORIGIN   text   optional, "false" lets you test the API in a browser tab
 *   LIMITER          optional Rate Limiting binding (otherwise a per-isolate limiter is used)
 *
 * Games nobody has touched for 30 days are deleted.
 */

const LIMITS = { name: 24, frames: 60, events: 600, body: 4096, idleMs: 30 * 86400_000 };
const RATE = { windowMs: 60_000, read: 120, write: 60, create: 12 };
const ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i: easy to read out
const FOUL_KINDS = new Set(["white", "nothing", "wrong-first", "wrong-pot", "off", "touch", "seven", "outside-d", "other"]);

class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
      });
    }
    try {
      const path = url.pathname;
      if (path === "/api/health") return reply({ ok: true, db: hasDb(env) }, 200, cors);
      const originOk = allowed.includes(origin) || (!origin && env.REQUIRE_ORIGIN === "false");
      if (!originOk) throw new ApiError(403, "forbidden", "This API only serves its own website.");
      if (!hasDb(env)) throw new ApiError(503, "not_configured", "Shared games aren't switched on yet.");
      await schema(env.DB);

      const m = /^\/api\/games(?:\/([a-z2-9]{10})(?:\/(join|act))?)?$/.exec(path);
      if (!m) throw new ApiError(404, "not_found", "Nothing here.");
      const [, id, action] = m;
      if (request.method === "GET" && id && !action) {
        await rateLimit(request, env, "read");
        return reply(await getGame(env, id, url.searchParams.get("v")), 200, cors);
      }
      if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "That method isn't supported here.");
      const body = await readBody(request);
      if (!id) {
        await rateLimit(request, env, "create");
        if (Math.random() < 0.05) ctx?.waitUntil?.(env.DB.prepare("DELETE FROM games WHERE updated < ?").bind(Date.now() - LIMITS.idleMs).run().catch(() => {}));
        return reply(await createGame(env, body), 201, cors);
      }
      await rateLimit(request, env, "write");
      if (action === "join") return reply(await join(env, id, body), 200, cors);
      if (action === "act") return reply(await act(env, id, body), 200, cors);
      throw new ApiError(404, "not_found", "Nothing here.");
    } catch (err) {
      if (err instanceof ApiError) return reply({ error: err.code, message: err.message, ...(err.extra || {}) }, err.status, cors);
      console.error("unexpected", err && err.message);
      return reply({ error: "server_error", message: "Something went wrong. Try again." }, 500, cors);
    }
  },
};

const hasDb = (env) => !!(env.DB && typeof env.DB.prepare === "function");

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > LIMITS.body) throw new ApiError(413, "too_large", "That's too much data.");
  try {
    const body = JSON.parse(text || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw 0;
    return body;
  } catch {
    throw new ApiError(400, "bad_json", "That request couldn't be read.");
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const schemaReady = new WeakMap();
function schema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = db
    .prepare("SELECT id FROM games LIMIT 0")
    .all()
    .catch(() =>
      db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, v INTEGER NOT NULL, reds INTEGER NOT NULL, names TEXT NOT NULL, keys TEXT NOT NULL, frames TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)"
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS games_updated ON games (updated)"),
      ])
    )
    .catch((err) => {
      schemaReady.delete(db);
      throw err;
    });
  schemaReady.set(db, ready);
  return ready;
}

async function load(env, id) {
  const row = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(id).first();
  if (!row) throw new ApiError(404, "no_game", "This game link has expired or never existed.");
  return { id: row.id, v: row.v, reds: row.reds, names: JSON.parse(row.names), keys: JSON.parse(row.keys), frames: JSON.parse(row.frames) };
}

/** Save only if nobody else saved in between (v is the version we read). */
async function save(env, g, changes) {
  const sets = Object.keys(changes);
  const r = await env.DB.prepare(`UPDATE games SET v = v + 1, updated = ?, ${sets.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND v = ?`)
    .bind(Date.now(), ...sets.map((k) => JSON.stringify(changes[k])), g.id, g.v)
    .run();
  if (!r.meta || r.meta.changes !== 1) throw new ApiError(409, "stale", "The game moved on. Have another look.");
  Object.assign(g, changes, { v: g.v + 1 });
  return g;
}

/** What everyone may see: names, the rules setting and every move. Never the seat keys. */
const view = (g) => ({ id: g.id, reds: g.reds, players: g.names, frames: g.frames });

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

async function createGame(env, body) {
  const reds = [15, 10, 6].includes(body.reds) ? body.reds : 15;
  const now = Date.now();
  for (let tries = 0; tries < 3; tries++) {
    const id = randomId();
    const r = await env.DB.prepare("INSERT INTO games (id, v, reds, names, keys, frames, created, updated) VALUES (?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(id, reds, "[null,null]", "[null,null]", "[]", now, now)
      .run();
    if (r.meta && r.meta.changes === 1) return { id, v: 1, game: { id, reds, players: [null, null], frames: [] } };
  }
  throw new ApiError(500, "server_error", "Couldn't make a game. Try again.");
}

async function getGame(env, id, since) {
  const g = await load(env, id);
  if (since && String(g.v) === since) return { v: g.v, same: true };
  return { v: g.v, game: view(g) };
}

async function join(env, id, body) {
  const name = cleanName(body.name);
  for (let tries = 0; tries < 3; tries++) {
    const g = await load(env, id);
    const seat = g.keys.indexOf(null);
    if (seat < 0) throw new ApiError(409, "full", "Both sides are taken. You can still watch.");
    const token = randomHex(32);
    const names = g.names.slice();
    const keys = g.keys.slice();
    names[seat] = name;
    keys[seat] = await sha256(token);
    const changes = { names, keys };
    // when the second side joins, a coin toss decides who breaks
    if (!keys.includes(null) && !g.frames.length) changes.frames = [{ breaker: coin(), events: [] }];
    try {
      await save(env, g, changes);
      return { seat, token, v: g.v, game: view(g) };
    } catch (err) {
      if (err.code !== "stale") throw err; // someone joined at the same moment: look again
    }
  }
  throw new ApiError(409, "busy", "That was busy. Try again.");
}

async function act(env, id, body) {
  const g = await load(env, id);
  const seat = await seatFor(g, body.token);
  if (body.v !== g.v) throw new ApiError(409, "stale", "The game moved on. Have another look.", { v: g.v, game: view(g) });
  if (!g.frames.length) throw new ApiError(409, "waiting", "Waiting for the other side to join.");
  const e = cleanEvent(body.e);
  const frames = structuredClone(g.frames);
  const frame = frames[frames.length - 1];
  const match = { reds: g.reds, frames };
  const s = replayFrame(match);

  if (e.t === "restart") {
    // one side asks; the same move from the other side agrees and wipes the frame (or every frame)
    if (frame.ask && frame.ask.by !== seat) {
      if (frame.ask.all) frames.splice(0, frames.length, { breaker: frames[0].breaker, events: [] });
      else {
        frame.events = [];
        delete frame.ask;
      }
    } else frame.ask = { by: seat, all: !!e.all };
  } else if (e.t === "restart-no") {
    if (!frame.ask) throw new ApiError(409, "nothing", "Nobody asked to restart.");
    delete frame.ask;
  } else if (e.t === "undo") {
    const last = frame.events[frame.events.length - 1];
    if (!last) throw new ApiError(409, "nothing", "Nothing to undo in this frame.");
    if (last.by !== seat) throw new ApiError(403, "not_yours", "You can only undo your own move.");
    frame.events.pop();
  } else if (e.t === "next") {
    if (!s.over) throw new ApiError(409, "not_over", "This frame isn't over yet.");
    if (frames.length >= LIMITS.frames) throw new ApiError(409, "too_many", "That's a lot of frames. Start a new game.");
    frames.push({ breaker: 1 - frame.breaker, events: [] });
  } else {
    if (e.t === "concede") e.who = seat;
    else if (e.t !== "toss" && s.turn !== seat) throw new ApiError(403, "not_your_turn", "It's the other side's turn.");
    if (frame.events.length >= LIMITS.events) throw new ApiError(409, "too_many", "That frame is too long to keep.");
    try {
      apply(s, e);
    } catch {
      throw new ApiError(409, "illegal", "That move doesn't fit the game right now.");
    }
    frame.events.push({ ...e, by: seat });
  }
  await save(env, g, { frames });
  return { v: g.v, game: view(g) };
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

function cleanName(raw) {
  const name = String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw new ApiError(400, "bad_name", "Type a name first.");
  return [...name].slice(0, LIMITS.name).join("");
}

/** Only the fields each move needs, with only the values the rules know. */
function cleanEvent(e) {
  const bad = () => {
    throw new ApiError(400, "bad_move", "That move couldn't be read.");
  };
  if (!e || typeof e !== "object") bad();
  switch (e.t) {
    case "call":
      if (!COLOURS.includes(e.ball)) bad();
      return { t: "call", ball: e.ball };
    case "restart":
      return e.all === true ? { t: "restart", all: true } : { t: "restart" };
    case "pot":
      if (!BALLS.includes(e.ball)) bad();
      return e.extra === true ? { t: "pot", ball: e.ball, extra: true } : { t: "pot", ball: e.ball };
    case "foul": {
      if (!FOUL_KINDS.has(e.kind)) bad();
      const out = { t: "foul", kind: e.kind };
      if (e.hit !== undefined && e.hit !== null) {
        if (!BALLS.includes(e.hit)) bad();
        out.hit = e.hit;
      }
      if (e.reds !== undefined) {
        if (!Number.isInteger(e.reds) || e.reds < 0 || e.reds > 15) bad();
        if (e.reds) out.reds = e.reds;
      }
      if (e.colours !== undefined) {
        if (!Array.isArray(e.colours) || e.colours.length > 6 || e.colours.some((c) => !COLOURS.includes(c)) || new Set(e.colours).size !== e.colours.length) bad();
        if (e.colours.length) out.colours = e.colours.slice();
      }
      if (e.white === true) out.white = true;
      if (e.called !== undefined && e.called !== null) {
        if (!COLOURS.includes(e.called)) bad();
        out.called = e.called;
      }
      return out;
    }
    case "toss":
      if (e.who !== 0 && e.who !== 1) bad();
      return { t: "toss", who: e.who };
    case "miss":
    case "again":
    case "replace":
    case "free":
    case "concede":
    case "restart-no":
    case "undo":
    case "next":
      return { t: e.t };
    default:
      bad();
  }
}

async function seatFor(g, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new ApiError(401, "no_seat", "Join the game to play.");
  const h = await sha256(token);
  const seat = g.keys.findIndex((k) => k && same(k, h));
  if (seat < 0) throw new ApiError(401, "no_seat", "Join the game to play.");
  return seat;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomId() {
  const out = [];
  const buf = crypto.getRandomValues(new Uint8Array(20));
  for (const b of buf) {
    if (b < 248) out.push(ID_CHARS[b % 31]); // 248 = 8 × 31, so every character is equally likely
    if (out.length === 10) break;
  }
  return out.length === 10 ? out.join("") : randomId();
}
const coin = () => crypto.getRandomValues(new Uint8Array(1))[0] & 1;

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

const buckets = new Map();
async function rateLimit(request, env, bucket) {
  const key = `${bucket}:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
  if (env.LIMITER && typeof env.LIMITER.limit === "function") {
    const { success } = await env.LIMITER.limit({ key });
    if (!success) throw new ApiError(429, "rate_limited", "Too many requests. Give it a minute.");
    return;
  }
  const now = Date.now();
  const b = buckets.get(key) || { start: now, count: 0 };
  if (now - b.start > RATE.windowMs) {
    b.start = now;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  if (b.count > RATE[bucket]) throw new ApiError(429, "rate_limited", "Too many requests. Give it a minute.");
}

/* ------------------------------------------------------------------ */
/* Rules engine                                                        */
/* ------------------------------------------------------------------ */

// ---- engine: copied from js/engine.js by `npm run worker`. Don't edit it here. ----
// The rules of snooker as a tiny state machine. A frame is a list of events; the state is
// whatever those events add up to, so undo is just "drop the last event and replay".
// Pure functions only: no DOM, no storage. Tested in tests/engine.test.mjs.

const VALUE = { red: 1, yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };
const COLOURS = ["yellow", "green", "brown", "blue", "pink", "black"];
const BALLS = ["red", ...COLOURS];
const NAME = { red: "red", yellow: "yellow", green: "green", brown: "brown", blue: "blue", pink: "pink", black: "black", white: "white" };

/** Points still on the table in a full clearance from a given colour onwards (yellow 27 … black 7). */
const fromColour = (i) => COLOURS.slice(i).reduce((t, c) => t + VALUE[c], 0);

function newMatch({ players = ["Player 1", "Player 2"], reds = 15, breaker = 0 } = {}) {
  return { v: 1, players: players.slice(0, 2), reds, frames: [{ breaker, events: [] }] };
}

function startFrame(reds, breaker) {
  return {
    total: reds, // reds this frame started with (15, 10 or 6)
    reds, // reds left on the table
    phase: "red", // "red": a red is on · "colour": any colour (after potting a red) · "clear": colours in order
    next: 0, // in "clear", index into COLOURS of the colour on
    scores: [0, 0],
    turn: breaker,
    brk: 0, // current break
    best: [0, 0], // highest break this frame
    free: false, // a free ball is available to the player at the table
    inHand: true, // white is in hand in the D (break-off, or after it was potted / left the table)
    foul: null, // the foul just committed, while the incoming player decides what to do: { by, pen, why, snap }
    toSpot: [], // colours that need putting back on their spots after the last event, highest first
    lastRed: false, // the last pot of this visit was a red, so another red tap can mean "two reds in one shot"
    called: null, // the colour the player at the table has called (after a red)
    respot: false, // re-spotted black (scores were level after the final black)
    toss: false, // waiting for a coin toss to decide who plays the re-spotted black
    over: false,
    winner: null,
    conceded: null,
    log: [], // the shared list of everything that happened
  };
}

/** The balls the player at the table may legally pot right now. */
function ballsOn(s) {
  if (s.over || s.toss) return [];
  if (s.phase === "red") return s.free ? BALLS.slice() : ["red"];
  if (s.phase === "colour") return COLOURS.slice();
  return s.free ? COLOURS.slice(s.next) : [COLOURS[s.next]];
}

/** Value of "the ball on" for a foul: the red, the called colour (7 if none was called), or the next colour. */
function valueOn(s, called = s.called) {
  if (s.phase === "red") return 1;
  if (s.phase === "colour") return called ? VALUE[called] : 7;
  return VALUE[COLOURS[s.next]];
}

/** Points left for the player at the table, if they cleared up (counts the colour after a red). */
function remaining(s) {
  if (s.over) return 0;
  if (s.phase === "red") return s.reds * 8 + 27;
  if (s.phase === "colour") return 7 + s.reds * 8 + 27;
  return fromColour(s.next);
}

const maxBreak = (reds) => reds * 8 + 27;

/**
 * Would potting this ball be legal now? Returns
 *   { ok: true, pts, free?, extra? }   free: it's the free ball · extra: a second red in the same shot (ask first)
 *   { ok: false, reason }              reason: "over" | "toss" | "none" (no reds left) | "foul"
 */
function judgePot(s, ball) {
  if (s.over) return { ok: false, reason: "over" };
  if (s.toss) return { ok: false, reason: "toss" };
  if (ball === "red" && s.reds === 0) return { ok: false, reason: "none" };
  if (s.phase === "red") {
    if (ball === "red") return { ok: true, pts: 1 };
    if (s.free) return { ok: true, pts: 1, free: true };
  } else if (s.phase === "colour") {
    if (ball !== "red" && (!s.called || ball === s.called)) return { ok: true, pts: VALUE[ball] };
    if (s.lastRed) return { ok: true, pts: 1, extra: true };
  } else {
    const on = COLOURS[s.next];
    if (ball === on) return { ok: true, pts: VALUE[on] };
    if (s.free && ball !== "red" && COLOURS.indexOf(ball) > s.next) return { ok: true, pts: VALUE[on], free: true };
  }
  return { ok: false, reason: "foul" };
}

/**
 * Penalty for a foul: the highest of 4, the value of the ball on, and the value of any ball involved
 * (hit first, potted, or forced off the table). A few fouls are always 7.
 *   f = { kind, hit, reds, colours, called }
 */
function penalty(s, f = {}) {
  if (f.kind === "seven") return { pen: 7, why: "this foul is always worth 7" };
  const called = f.called || s.called;
  const parts = [{ v: 4, why: "4 is the minimum for any foul" }];
  if (s.phase === "colour" && !called) parts.push({ v: 7, why: "no colour had been called, which makes it 7" });
  else if (s.phase !== "red") {
    const name = s.phase === "colour" ? called : COLOURS[s.next];
    parts.push({ v: valueOn(s, called), why: `the ${name} you were on is worth ${VALUE[name]}` });
  }
  if (f.hit && f.hit !== "white") parts.push({ v: VALUE[f.hit], why: `the ${f.hit} it hit is worth ${VALUE[f.hit]}` });
  for (const c of f.colours || []) parts.push({ v: VALUE[c], why: `the ${c} that went in is worth ${VALUE[c]}` });
  const top = parts.reduce((a, b) => (b.v > a.v ? b : a));
  return { pen: Math.min(7, top.v), why: top.why };
}

const byValue = (list) => [...new Set(list)].sort((a, b) => VALUE[b] - VALUE[a]);

/** Scores level after the final black → re-spotted black; otherwise the frame is over. */
function finish(s) {
  s.brk = 0;
  if (s.scores[0] === s.scores[1]) {
    s.phase = "clear";
    s.next = 5;
    s.respot = true;
    s.toss = true;
    s.inHand = true;
    s.free = false;
    s.foul = null;
    s.toSpot = ["black"];
    s.log.push({ t: "respot" });
    return;
  }
  s.over = true;
  s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
}

const endVisit = (s) => {
  s.brk = 0;
  s.lastRed = false;
  s.free = false;
  s.called = null;
};

/** Apply one event and return the new state. Throws on an event the rules don't allow here. */
function apply(prev, e) {
  const s = structuredClone(prev);
  s.toSpot = [];
  switch (e.t) {
    case "pot": {
      const j = judgePot(s, e.ball);
      if (!j.ok) throw new Error(`illegal pot: ${e.ball} (${j.reason})`);
      if (j.extra && !e.extra) throw new Error("second red needs confirming");
      const p = s.turn;
      if (j.free) {
        s.toSpot = [e.ball];
        if (s.phase === "red") {
          s.phase = "colour";
          s.lastRed = true;
        }
      } else if (e.ball === "red") {
        s.reds--;
        s.phase = "colour";
        s.lastRed = true;
      } else if (s.phase === "colour") {
        s.toSpot = [e.ball]; // colours go back while reds remain, and after the colour following the last red
        s.phase = s.reds > 0 ? "red" : "clear";
        s.next = 0;
        s.lastRed = false;
      } else {
        s.next++;
        s.lastRed = false;
      }
      s.called = null;
      s.scores[p] += j.pts;
      s.brk += j.pts;
      s.best[p] = Math.max(s.best[p], s.brk);
      s.free = false;
      s.inHand = false;
      s.foul = null;
      s.log.push({ t: "pot", p, ball: e.ball, pts: j.pts, free: !!j.free });
      if (s.phase === "clear" && s.next === 6) finish(s);
      else if (s.respot) finish(s); // potting the re-spotted black wins it
      return s;
    }
    case "miss": {
      if (s.over || s.toss) throw new Error("no one at the table");
      s.log.push({ t: "miss", p: s.turn });
      endVisit(s);
      if (s.phase === "colour") {
        s.phase = s.reds > 0 ? "red" : "clear";
        s.next = 0;
      }
      s.inHand = false;
      s.foul = null;
      s.turn = 1 - s.turn;
      return s;
    }
    case "foul": {
      if (s.over || s.toss) throw new Error("no one at the table");
      const { pen, why } = penalty(s, e);
      const by = s.turn;
      const opp = 1 - by;
      const snap = { reds: s.reds, phase: s.phase, next: s.next, inHand: s.inHand, free: s.free, lastRed: s.lastRed, called: s.called };
      s.scores[opp] += pen;
      s.reds -= Math.min(e.reds || 0, s.reds); // reds potted on a foul stay down
      s.toSpot = byValue(e.colours || []); // colours potted on a foul always go back
      s.log.push({ t: "foul", p: by, to: opp, pen, why, kind: e.kind || "other", white: !!e.white });
      const lastBlack = s.phase === "clear" && s.next === 5;
      endVisit(s);
      s.turn = opp;
      if (lastBlack) {
        // with only the black left, a foul ends the frame (unless that leaves the scores level)
        s.respot = false;
        finish(s);
        return s;
      }
      if (s.phase !== "clear") {
        s.phase = s.reds > 0 ? "red" : "clear";
        if (s.phase === "clear") s.next = 0;
      }
      s.inHand = !!e.white;
      s.foul = { by, pen, why, snap };
      return s;
    }
    case "again": // the incoming player makes the offender play again from where the balls are
    case "replace": {
      // "replace": foul and a miss, balls go back where they were and the offender plays again
      if (!s.foul) throw new Error("no foul to answer");
      const { by, snap } = s.foul;
      if (e.t === "replace") Object.assign(s, snap);
      else s.called = null;
      s.free = false;
      s.lastRed = e.t === "replace" ? snap.lastRed : false;
      s.turn = by;
      s.foul = null;
      s.log.push({ t: e.t, p: by });
      return s;
    }
    case "call": {
      // the player names the colour they're going for; tapping another colour changes the call
      if (s.over || s.toss || s.phase !== "colour" || !COLOURS.includes(e.ball)) throw new Error("nothing to call");
      s.called = e.ball;
      s.lastRed = false; // after calling, another red is no longer "the same shot"
      return s;
    }
    case "free": {
      if (!s.foul) throw new Error("free ball only after a foul");
      s.free = true;
      s.foul = null;
      s.log.push({ t: "free", p: s.turn });
      return s;
    }
    case "toss": {
      if (!s.toss) throw new Error("no toss due");
      s.toss = false;
      s.turn = e.who;
      s.inHand = true;
      return s;
    }
    case "concede": {
      if (s.over) throw new Error("frame already over");
      s.over = true;
      s.conceded = e.who;
      s.winner = 1 - e.who;
      s.toss = false;
      s.foul = null;
      s.log.push({ t: "concede", p: e.who });
      return s;
    }
    default:
      throw new Error(`unknown event ${e.t}`);
  }
}

/** Balls the white may hit first right now (the called colour, if one was called). */
function firstOn(s) {
  if (s.phase === "colour") return s.called ? [s.called] : COLOURS.slice();
  return ballsOn(s);
}

const ON_WORDS = (s) =>
  s.phase === "red" ? "a red" : s.phase === "colour" ? (s.called ? `the ${s.called} (your call)` : "a colour") : `the ${COLOURS[s.next]}`;

/** Fouls that aren't about which ball was hit or what went in. */
const OTHER_FOULS = {
  touch: "Touched a ball with the hand, cue or clothes",
  push: "Push or double hit (the tip stayed on the white, or hit it twice)",
  jump: "Jumped the white over a ball",
  feet: "Both feet off the floor",
  early: "Played before the balls stopped",
  "outside-d": "Played from outside the D with the white in hand",
  seven: "A 7-point foul: reds twice in a row, or used a ball to measure",
};

/**
 * Describe a shot in plain words and get the ruling, so nobody has to know the rules first.
 *   shot = { first: a ball | "nothing", reds: n, colours: [...], white: bool, other: key of OTHER_FOULS, called }
 *   (reds/colours/white: what went in or off the table; called: the colour they meant, if not called yet)
 * Returns { result: "pot" | "miss" | "foul", events, reasons, pts?, pen?, why? }
 */
function judgeShot(s, shot) {
  const first = shot.first || "nothing";
  const reds = Math.min(shot.reds || 0, s.reds);
  const colours = [...new Set(shot.colours || [])];
  const reasons = [];
  // with no call yet, the colour hit first is the one they were playing
  const called = s.phase === "colour" ? s.called || shot.called || (COLOURS.includes(first) ? first : null) : null;
  const on = s.phase === "colour" && called ? [called] : firstOn(s);
  const words = s.phase === "colour" && called ? `the ${called}${s.called ? " (your call)" : ""}` : ON_WORDS(s);

  if (shot.other) reasons.push(`${OTHER_FOULS[shot.other]}.`);
  if (first === "nothing") reasons.push("The white didn't hit any ball.");
  else if (!on.includes(first)) reasons.push(`You were on ${words}, but the white hit the ${first} first.`);
  if (shot.white) reasons.push("The white went in (or off the table).");

  // what went in, and whether it was allowed to
  const freeBall = s.free && COLOURS.includes(first) && on.includes(first) && first !== (s.phase === "clear" ? COLOURS[s.next] : null);
  if (s.phase === "red") {
    for (const c of colours) if (!(freeBall && c === first)) reasons.push(`The ${c} went in, but you were on a red.`);
  } else if (s.phase === "colour") {
    if (reds) reasons.push(`A red went in, but you were on a colour.`);
    for (const c of colours) if (c !== called) reasons.push(called ? `The ${c} went in, but you were on the ${called}.` : `The ${c} went in.`);
  } else {
    const ball = COLOURS[s.next];
    for (const c of colours) if (c !== ball && !(freeBall && c === first)) reasons.push(`The ${c} went in, but you were on the ${ball}.`);
  }

  if (reasons.length) {
    const kind = shot.other === "seven" ? "seven" : shot.other === "outside-d" ? "outside-d" : shot.other ? "touch" : shot.white ? "white" : first === "nothing" ? "nothing" : !on.includes(first) ? "wrong-first" : "wrong-pot";
    const ev = { t: "foul", kind };
    if (BALLS.includes(first)) ev.hit = first;
    if (reds) ev.reds = reds;
    if (colours.length) ev.colours = colours;
    if (shot.white) ev.white = true;
    if (s.phase === "colour" && called && !s.called) ev.called = called;
    const { pen, why } = penalty(s, ev);
    return { result: "foul", events: [ev], reasons, pen, why };
  }
  if (!reds && !colours.length) return { result: "miss", events: [{ t: "miss" }], reasons: [`The white hit ${words} first and nothing went in. That's not a foul.`] };

  const events = [];
  let pts = 0;
  if (freeBall && colours.length) {
    events.push({ t: "pot", ball: colours[0] });
    pts += s.phase === "red" ? 1 : VALUE[COLOURS[s.next]];
  }
  for (let i = 0; i < reds; i++) {
    events.push(i === 0 && !events.length ? { t: "pot", ball: "red" } : { t: "pot", ball: "red", extra: true });
    pts += 1;
  }
  if (s.phase === "colour") {
    if (!s.called) events.push({ t: "call", ball: called });
    events.push({ t: "pot", ball: called });
    pts += VALUE[called];
  } else if (s.phase === "clear" && !freeBall) {
    events.push({ t: "pot", ball: COLOURS[s.next] });
    pts += VALUE[COLOURS[s.next]];
  }
  return { result: "pot", events, reasons: [], pts };
}

function replayFrame(match, i = match.frames.length - 1) {
  const f = match.frames[i];
  return f.events.reduce(apply, startFrame(match.reds, f.breaker));
}

/** Frames won by each player (finished frames only). */
function framesWon(match) {
  const won = [0, 0];
  match.frames.forEach((_, i) => {
    const s = replayFrame(match, i);
    if (s.over) won[s.winner]++;
  });
  return won;
}

function nextFrame(match) {
  const last = match.frames[match.frames.length - 1];
  return { ...match, frames: [...match.frames, { breaker: 1 - last.breaker, events: [] }] };
}

/** Lead and whether the player behind needs snookers (their deficit is more than what's left). */
function standing(s) {
  const [a, b] = s.scores;
  const lead = Math.abs(a - b);
  const leader = a === b ? null : a > b ? 0 : 1;
  const left = remaining(s);
  return { lead, leader, left, snookers: leader !== null && !s.over && lead > left };
}
// ---- end engine ----

export const _test = { cleanEvent, cleanName, randomId };
