/**
 * Chalk: shared snooker and 8-ball pool games. One small Worker, one D1 table.
 *
 * Anyone with a game's link can watch it live. Each side joins by typing a name (their own or a
 * team's) and gets a private seat key, kept on their phone. Every move is checked here with the
 * same rules engine the page uses, and it is only accepted from the side whose turn it is:
 *   pot, miss, foul           the player at the table
 *   play again, free ball,    the player coming in after a foul (it's their choice)
 *   foul & miss put back
 *   concede                   only for yourself
 *   undo                      only your own last move
 *   coin toss, next game      either side (not once someone has won a best-of match)
 *   restart game / match      one side asks, the other side agrees (it wipes both scores)
 * So one side can never add to, or take away from, the other's score, and both see everything.
 *
 * Routes (JSON):
 *   GET  /api/health
 *   POST /api/games                  { reds, target } or { game: "pool", target }  → { id, v, game }
 *                                    target: games needed to win the match (2, 3, 4), or none
 *   GET  /api/games/<id>?v=<n>       → { v, game }, or { v, same: true } when nothing changed
 *   POST /api/games/<id>/join        { name, team? }     → { seat, token, v, game }
 *                                    team: the players on this side, for doubles (2 to 4 names)
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

const LIMITS = { name: 24, team: 4, frames: 60, events: 600, body: 4096, idleMs: 30 * 86400_000 };
const TARGETS = new Set([2, 3, 4]); // best of 3, 5, 7
const RATE = { windowMs: 60_000, read: 120, write: 60, create: 12 };
const ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i: easy to read out
const FOUL_KINDS = new Set(["white", "nothing", "wrong-first", "wrong-pot", "off", "touch", "seven", "outside-d", "other"]);
const POOL_OPTIONS = new Set(["accept", "rerack-me", "rerack-them", "spot8", "rebreak", "kitchen"]);
const engineFor = (kind) => (kind === "pool" ? POOL : SNOOKER);

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
    .prepare("SELECT kind, meta FROM games LIMIT 0")
    .all()
    .catch(async () => {
      await db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, v INTEGER NOT NULL, reds INTEGER NOT NULL, names TEXT NOT NULL, keys TEXT NOT NULL, frames TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'snooker', meta TEXT NOT NULL DEFAULT '{}')"
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS games_updated ON games (updated)"),
      ]);
      // tables made before pool (kind) or best-of matches and doubles (meta) get the columns now
      await db.prepare("ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'snooker'").run().catch(() => {});
      await db.prepare("ALTER TABLE games ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'").run().catch(() => {});
    })
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
  const meta = JSON.parse(row.meta || "{}");
  return { id: row.id, v: row.v, kind: row.kind === "pool" ? "pool" : "snooker", reds: row.reds, names: JSON.parse(row.names), keys: JSON.parse(row.keys), frames: JSON.parse(row.frames), meta };
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

/** What everyone may see: names, teams, the settings and every move. Never the seat keys. */
const view = (g) => ({ id: g.id, kind: g.kind, reds: g.reds, target: g.meta.target || 0, teams: g.meta.teams || [null, null], players: g.names, frames: g.frames });

/** Has a side won a best-of match? */
function matchOver(g, frames) {
  if (!g.meta.target) return false;
  const won = engineFor(g.kind).framesWon({ reds: g.reds, frames });
  return won.some((w) => w >= g.meta.target);
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

async function createGame(env, body) {
  const kind = body.game === "pool" ? "pool" : "snooker";
  const reds = kind === "pool" ? 0 : [15, 10, 6].includes(body.reds) ? body.reds : 15;
  const meta = TARGETS.has(body.target) ? { target: body.target } : {};
  const now = Date.now();
  for (let tries = 0; tries < 3; tries++) {
    const id = randomId();
    const r = await env.DB.prepare("INSERT INTO games (id, v, kind, reds, names, keys, frames, meta, created, updated) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(id, kind, reds, "[null,null]", "[null,null]", "[]", JSON.stringify(meta), now, now)
      .run();
    if (r.meta && r.meta.changes === 1) return { id, v: 1, game: view({ id, kind, reds, names: [null, null], frames: [], meta }) };
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
  const team = body.team === undefined ? null : cleanTeam(body.team);
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
    if (team) {
      const teams = (g.meta.teams || [null, null]).slice();
      teams[seat] = team;
      changes.meta = { ...g.meta, teams };
    }
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
  const e = cleanEvent(body.e, g.kind);
  const E = engineFor(g.kind);
  const frames = structuredClone(g.frames);
  const frame = frames[frames.length - 1];
  const match = { reds: g.reds, frames };
  const s = E.replayFrame(match);

  if (e.t === "restart") {
    // one side asks; the same move from the other side agrees and wipes the frame (or every frame)
    // `restarts` counts fresh starts, so each phone knows the balls need setting up again
    if (frame.ask && frame.ask.by !== seat) {
      const restarts = Math.max(...frames.map((f) => f.restarts || 0)) + 1;
      if (frame.ask.all) frames.splice(0, frames.length, { breaker: frames[0].breaker, events: [], restarts });
      else {
        frame.events = [];
        frame.restarts = restarts;
        delete frame.ask;
      }
    } else frame.ask = { by: seat, all: !!e.all };
  } else if (e.t === "restart-no") {
    if (!frame.ask) throw new ApiError(409, "nothing", "Nobody asked to restart.");
    delete frame.ask;
  } else if (e.t === "undo") {
    const last = frame.events[frame.events.length - 1];
    if (!last) throw new ApiError(409, "nothing", "Nothing to undo in this game.");
    if (last.by !== seat) throw new ApiError(403, "not_yours", "You can only undo your own move.");
    frame.events.pop();
  } else if (e.t === "next") {
    if (!s.over) throw new ApiError(409, "not_over", "This game isn't over yet.");
    if (matchOver(g, frames)) throw new ApiError(409, "match_over", "The match is over.");
    if (frames.length >= LIMITS.frames) throw new ApiError(409, "too_many", "That's a lot of games. Start a new match.");
    frames.push({ breaker: 1 - frame.breaker, events: [] });
  } else {
    if (e.t === "concede") e.who = seat;
    else if (e.t !== "toss" && s.turn !== seat) throw new ApiError(403, "not_your_turn", "It's the other side's turn.");
    if (frame.events.length >= LIMITS.events) throw new ApiError(409, "too_many", "That game is too long to keep.");
    try {
      E.apply(s, e);
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

/** A doubles side: 2 to 4 names. */
function cleanTeam(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > LIMITS.team) throw new ApiError(400, "bad_team", "A team is 2 to 4 names.");
  return raw.map(cleanName);
}

/** Only the fields each move needs, with only the values the rules know. */
function cleanEvent(e, kind = "snooker") {
  const bad = () => {
    throw new ApiError(400, "bad_move", "That move couldn't be read.");
  };
  if (!e || typeof e !== "object") bad();
  if (kind === "pool") return cleanPoolEvent(e, bad);
  const { BALLS, COLOURS } = SNOOKER;
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

function cleanPoolEvent(e, bad) {
  const ball = (n) => Number.isInteger(n) && n >= 1 && n <= 15;
  switch (e.t) {
    case "shot": {
      const out = { t: "shot" };
      if (e.first !== undefined) {
        if (e.first !== "nothing" && !ball(e.first)) bad();
        out.first = e.first;
      }
      if (!Array.isArray(e.potted) || e.potted.length > 15 || !e.potted.every(ball) || new Set(e.potted).size !== e.potted.length) bad();
      out.potted = e.potted.slice();
      if (e.white === true) out.white = true;
      out.rail = e.rail === true;
      if (e.other !== undefined && e.other !== null) {
        if (!Object.hasOwn(POOL.OTHER_FOULS, e.other)) bad();
        out.other = e.other;
      }
      if (e.eight !== undefined) {
        if (e.eight !== "called" && e.eight !== "wrong") bad();
        out.eight = e.eight;
      }
      if (e.safety === true) out.safety = true;
      if (e.uncalled === true) out.uncalled = true;
      if (e.called !== undefined && e.called !== null) {
        if (!ball(e.called)) bad();
        out.called = e.called;
      }
      return out;
    }
    case "choose":
      if (!POOL_OPTIONS.has(e.opt)) bad();
      return { t: "choose", opt: e.opt };
    case "restart":
      return e.all === true ? { t: "restart", all: true } : { t: "restart" };
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

// ---- engines: copied from js/snooker/engine.js and js/pool/engine.js by `npm run worker`. Don't edit them here. ----
const SNOOKER = (() => {
  // The rules of snooker as a tiny state machine. A frame is a list of events; the state is
  // whatever those events add up to, so undo is just "drop the last event and replay".
  // Pure functions only: no DOM, no storage. Tested in tests/snooker.test.mjs.

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

  /** Is a shot expected right now? (Not once the frame is over, nor while a coin toss is due.) */
  const playable = (s) => !s.over && !s.toss;

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
  return { VALUE, COLOURS, BALLS, NAME, newMatch, startFrame, playable, ballsOn, valueOn, remaining, maxBreak, judgePot, penalty, apply, firstOn, OTHER_FOULS, judgeShot, replayFrame, framesWon, nextFrame, standing };
})();

const POOL = (() => {
  // 8-ball pool (WPA Rules of Play, effective 2025-09-15) as a tiny state machine, like engine.js
  // for snooker: a rack is a list of events, the state is what they add up to, undo drops the last.
  // Pure functions only: no DOM, no storage. Tested in tests/pool.test.mjs.
  //
  // There are no points in 8-ball: you pot your group (solids 1-7 or stripes 9-15), then the 8.
  // Every shot is described in plain terms and ruled on here:
  //   { t: "shot", first, potted, white, rail, other, eight, safety, called }
  //     first    the ball the white hit first (a number), or "nothing"
  //     potted   numbers that went in (or flew off the table)
  //     white    the white went in or off the table
  //     rail     a ball touched a cushion after the white hit one (on the break: 4 or more balls did)
  //     other    another foul: touch | push | feet | moving | placement | off
  //     eight    "called" | "wrong": did the 8 go in the pocket the shooter called
  //     safety   the shooter called safety (the turn passes even if one of theirs goes in)
  //     called   on an open table, which ball was called when both groups went in

  const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
  const STRIPES = [9, 10, 11, 12, 13, 14, 15];
  const ALL = [...SOLIDS, 8, ...STRIPES];
  const COLOUR = { 1: "yellow", 2: "blue", 3: "red", 4: "purple", 5: "orange", 6: "green", 7: "maroon", 8: "black" };
  const groupOf = (n) => (n === 8 ? null : n < 8 ? "solids" : "stripes");
  const colourOf = (n) => COLOUR[n > 8 ? n - 8 : n];
  const GROUP = { solids: SOLIDS, stripes: STRIPES };
  const GROUP_WORDS = { solids: "solids (1–7)", stripes: "stripes (9–15)" };

  const OTHER_FOULS = {
    touch: "Touched a ball with the hand, cue or clothes",
    push: "Push or double hit (the tip stayed on the white, or hit it twice)",
    feet: "Both feet off the floor",
    moving: "Played before the balls stopped",
    placement: "With the white in hand behind the line: played it from past the line, or hit a ball behind the line first without crossing it",
    off: "A ball flew off the table (it stays off)",
  };

  function newMatch({ players = ["Player 1", "Player 2"], breaker = 0 } = {}) {
    return { v: 1, game: "pool", players: players.slice(0, 2), frames: [{ breaker, events: [] }] };
  }

  function startFrame(_, breaker) {
    return {
      game: "pool",
      table: ALL.slice(), // balls still on the table
      groups: null, // [group of player 0, group of player 1] once decided
      turn: breaker,
      breaker,
      breakShot: true,
      inHand: "kitchen", // "kitchen": behind the head string (break) · "anywhere": after a foul · null
      choice: null, // a decision owed after the break: { kind, by } (the player at the table decides)
      spot8: false, // the 8 has to go back on the foot spot before the next shot
      run: 0, // balls potted this visit
      best: [0, 0], // most balls potted in one visit, per player
      over: false,
      winner: null,
      how: null, // why the rack ended, in words
      conceded: null,
      log: [],
    };
  }

  /** Is a shot expected right now? (Not once the rack is over, nor while a break choice is owed.) */
  const playable = (s) => !s.over && !s.choice;

  /** The group a player is on, or null while the table is open. */
  const groupFor = (s, p) => (s.groups ? s.groups[p] : null);

  /** Balls of a player's group still on the table. */
  function left(s, p) {
    const g = groupFor(s, p);
    return g ? GROUP[g].filter((n) => s.table.includes(n)) : null;
  }

  /** What the white may hit first right now. */
  function targets(s, p = s.turn) {
    if (s.breakShot) return s.table.slice();
    const g = groupFor(s, p);
    if (!g) {
      // open table: anything but the 8, unless a whole group is already down
      const cleared = ["solids", "stripes"].some((x) => !GROUP[x].some((n) => s.table.includes(n)));
      return s.table.filter((n) => n !== 8 || cleared);
    }
    const mine = left(s, p);
    return mine.length ? mine : [8];
  }

  const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : String(list[0]));
  const ON = (s, p = s.turn) => {
    const g = groupFor(s, p);
    if (!g) return "an open table (any ball but the 8)";
    return left(s, p).length ? GROUP_WORDS[g] : "the 8";
  };

  /**
   * Rule on a shot. Returns
   *   { result, reasons, choice?, assign?, how? }
   *   result: "continue" (shooter stays on) · "pass" (no foul, turn passes) · "foul" (ball in hand)
   *           "win" · "loss" · "choice" (a break situation where someone picks what happens next)
   */
  function judge(s, shot) {
    const potted = [...new Set(shot.potted || [])].filter((n) => s.table.includes(n));
    const white = !!shot.white;
    const other = shot.other || null;
    const reasons = [];
    const shooter = s.turn;

    if (s.breakShot) {
      const fouled = white || !!other;
      if (potted.includes(8) && other === "off") {
        // the 8 driven off the table on the break: it's spotted, and the incoming player takes the
        // table as it lies or the white behind the line (WPA 4.3(g), 4.7)
        reasons.push("The 8 left the table on the break. It isn't a loss: it goes back on the foot spot.");
        if (white) reasons.push("The white went in (or off the table) too.");
        return { result: "choice", choice: "eight-off-break", reasons };
      }
      if (potted.includes(8)) {
        if (fouled) {
          if (white) reasons.push("The white went in (or off the table).");
          if (other) reasons.push(`${OTHER_FOULS[other]}.`);
          reasons.push("The 8 went in on a foul break. It isn't a loss on the break.");
          return { result: "choice", choice: "eight-break-foul", reasons };
        }
        return { result: "choice", choice: "eight-break", reasons: ["The 8 went in on the break. That's not a foul and not a loss."] };
      }
      if (!potted.length && !shot.rail) {
        // decided before a scratch: a scratch doesn't make an illegal break legal (WPA 4.3(d))
        reasons.push("Nothing went in and fewer than 4 balls hit a cushion: an illegal break.");
        if (white) reasons.push("The white went in too, so if the table is played as it lies, the white goes behind the line.");
        if (other) reasons.push(`${OTHER_FOULS[other]}.`);
        return { result: "choice", choice: "illegal-break", reasons };
      }
      if (white) {
        reasons.push("The white went in (or off the table) on the break.");
        if (other) reasons.push(`${OTHER_FOULS[other]}.`);
        return { result: "foul", reasons, kitchen: true };
      }
      if (other) return { result: "choice", choice: "break-foul", reasons: [`${OTHER_FOULS[other]}.`] };
      if (potted.length) return { result: "continue", reasons: [`${potted.length === 1 ? "A ball" : `${potted.length} balls`} went in on the break. Keep going: the table is still open.`] };
      return { result: "pass", reasons: ["A legal break: 4 or more balls hit a cushion. Nothing went in, so it's the other player's turn. The table is open."] };
    }

    const can = targets(s);
    const g = groupFor(s, shooter);
    const first = shot.first ?? "nothing";
    // open table with a whole group already down: you may claim it for now and play the 8 (WPA 4.4)
    const onEightOpen = !g && first === 8 && can.includes(8);
    if (other) reasons.push(`${OTHER_FOULS[other]}.`);
    if (first === "nothing") reasons.push("The white didn't hit any ball.");
    else if (!can.includes(first)) {
      if (first === 8 && !g) reasons.push("On an open table you can't hit the 8 first.");
      else if (first === 8) reasons.push(`You're on ${ON(s)}, but the white hit the 8 first.`);
      else reasons.push(`You're on ${ON(s)}, but the white hit ${groupOf(first) === "solids" ? "a solid" : "a stripe"} first.`);
    }
    if (white) reasons.push("The white went in (or off the table).");
    if (!potted.length && first !== "nothing" && !shot.rail && !white) reasons.push("Nothing went in, and no ball touched a cushion after the white hit the first ball.");

    if (potted.includes(8)) {
      const eightOn = can.includes(8);
      if (other === "off") return { result: "loss", reasons: [...reasons, "The 8 left the table."], how: "drove the 8 off the table" };
      if (reasons.length) return { result: "loss", reasons: [...reasons, "The 8 went in on a foul."], how: "potted the 8 on a foul" };
      if (!eightOn || (!g && !onEightOpen)) return { result: "loss", reasons: [`The 8 went in before ${g ? `all the ${g}` : "a group"} ${g ? "were" : "was"} down.`], how: "potted the 8 too early" };
      if (potted.some((n) => n !== 8 && groupOf(n) === g)) return { result: "loss", reasons: ["The 8 went in on the same shot as one of your own balls. It has to be the last ball you pot."], how: "potted the 8 too early" };
      if (shot.safety) return { result: "loss", reasons: ["You called safety, so no pocket was called for the 8."], how: "potted the 8 on a safety" };
      if (shot.eight !== "called") return { result: "loss", reasons: ["The 8 went in a pocket you didn't call."], how: "potted the 8 in the wrong pocket" };
      return { result: "win", reasons: ["The 8 went in the pocket you called."], how: "potted the 8" };
    }
    if (reasons.length) return { result: "foul", reasons };

    if (!potted.length) return { result: "pass", reasons: ["A fair shot: the white hit the right ball first and a ball touched a cushion. Nothing went in, so it's the other player's turn."] };
    if (shot.uncalled) return { result: "pass", reasons: [`The ball you called didn't go in, so your turn ends. ${potted.length > 1 ? "The balls" : "The ball"} that went in stay${potted.length > 1 ? "" : "s"} down${g ? "" : ", and the table stays open"}.`] };
    if (onEightOpen) return { result: "pass", reasons: ["You played the 8 (your group is down), and it didn't go in, so the turn passes. The table stays open."] };
    if (!g) {
      // open table: the called ball decides the groups
      const groupsIn = [...new Set(potted.map(groupOf))];
      const called = groupsIn.length > 1 ? shot.called : potted[0];
      if (shot.safety) return { result: "pass", reasons: ["You called safety, so the turn passes and the table stays open. The balls stay down."] };
      if (!called || !potted.includes(called)) return { result: "pass", reasons: ["Say which ball you'd called."], needCalled: true };
      const mine = groupOf(called);
      return { result: "continue", assign: mine, reasons: [`You potted the ${called}: you're ${GROUP_WORDS[mine]}, the other player has the ${mine === "solids" ? "stripes" : "solids"}.`] };
    }
    if (shot.safety) return { result: "pass", reasons: ["You called safety, so the turn passes. Anything that went in stays down."] };
    const mine = potted.filter((n) => groupOf(n) === g);
    if (mine.length) return { result: "continue", reasons: [`${words(mine)} ${mine.length > 1 ? "are" : "is"} yours: keep going.`] };
    return { result: "pass", reasons: [`Only the other player's ${potted.length > 1 ? "balls" : "ball"} went in (${words(potted)}). Not a foul, but your turn ends and ${potted.length > 1 ? "they stay" : "it stays"} down.`] };
  }

  function finish(s, winner, how) {
    s.over = true;
    s.winner = winner;
    s.how = how;
    s.inHand = null;
    s.choice = null;
  }

  function rerack(s, breaker) {
    Object.assign(s, { table: ALL.slice(), groups: null, turn: breaker, breaker, breakShot: true, inHand: "kitchen", choice: null, spot8: false, run: 0 });
  }

  const OPTIONS = {
    "illegal-break": ["accept", "rerack-me", "rerack-them"],
    "eight-break": ["spot8", "rebreak"],
    "eight-break-foul": ["spot8", "rebreak"],
    "break-foul": ["accept", "kitchen"],
    "eight-off-break": ["accept", "kitchen"],
  };
  const optionsFor = (s) => (s.choice ? OPTIONS[s.choice.kind] : []);

  /** Apply one event and return the new state. Throws on an event the rules don't allow here. */
  function apply(prev, e) {
    const s = structuredClone(prev);
    s.spot8 = false;
    switch (e.t) {
      case "shot": {
        if (s.over || s.choice) throw new Error("no shot to play");
        const r = judge(s, e);
        if (r.needCalled) throw new Error("which ball was called?");
        const p = s.turn;
        const potted = [...new Set(e.potted || [])].filter((n) => s.table.includes(n));
        const wasBreak = s.breakShot;
        s.table = s.table.filter((n) => !potted.includes(n)); // nothing but the 8 (on the break) ever comes back
        s.breakShot = false;
        s.inHand = null;
        s.log.push({ t: "shot", p, potted, result: r.result, brk: wasBreak, white: !!e.white });
        if (r.result === "continue") {
          if (r.assign) s.groups = p === 0 ? [r.assign, rival(r.assign)] : [rival(r.assign), r.assign];
          s.run += potted.filter((n) => n !== 8).length;
          s.best[p] = Math.max(s.best[p], s.run);
        } else if (r.result === "pass") {
          s.run = 0;
          s.turn = 1 - p;
        } else if (r.result === "foul") {
          s.run = 0;
          s.turn = 1 - p;
          s.inHand = r.kitchen ? "kitchen" : "anywhere";
        } else if (r.result === "win") {
          finish(s, p, r.how);
        } else if (r.result === "loss") {
          finish(s, 1 - p, r.how);
        } else if (r.result === "choice") {
          s.run = 0;
          const breakerDecides = r.choice === "eight-break";
          s.choice = { kind: r.choice, by: breakerDecides ? p : 1 - p, breaker: p, ...(e.white ? { white: true } : {}) };
          s.turn = s.choice.by;
        }
        return s;
      }
      case "choose": {
        if (!s.choice || !optionsFor(s).includes(e.opt)) throw new Error("nothing to choose");
        const { kind, by, breaker, white } = s.choice;
        s.choice = null;
        s.log.push({ t: "choose", p: by, opt: e.opt, kind });
        if (kind === "eight-off-break") {
          s.table = [...s.table, 8].sort((a, b) => a - b);
          s.spot8 = true;
        }
        if (e.opt === "accept") {
          s.turn = by;
          s.inHand = white ? "kitchen" : null; // the white went in: it comes out behind the line
        } else if (e.opt === "kitchen") {
          s.turn = by;
          s.inHand = "kitchen";
        } else if (e.opt === "rerack-me") rerack(s, by);
        else if (e.opt === "rerack-them") rerack(s, breaker);
        else if (e.opt === "rebreak") rerack(s, by);
        else if (e.opt === "spot8") {
          s.table = [...s.table, 8].sort((a, b) => a - b);
          s.spot8 = true;
          s.turn = by;
          s.inHand = kind === "eight-break-foul" ? "kitchen" : null; // breaker carries on as the balls lie
          if (kind === "eight-break") {
            s.run = 1;
            s.best[by] = Math.max(s.best[by], s.run);
          }
        }
        return s;
      }
      case "concede": {
        if (s.over) throw new Error("rack already over");
        s.log.push({ t: "concede", p: e.who });
        finish(s, 1 - e.who, "conceded");
        s.conceded = e.who;
        return s;
      }
      default:
        throw new Error(`unknown event ${e.t}`);
    }
  }

  const rival = (g) => (g === "solids" ? "stripes" : "solids");

  function replayFrame(match, i = match.frames.length - 1) {
    const f = match.frames[i];
    return f.events.reduce(apply, startFrame(null, f.breaker));
  }

  function framesWon(match) {
    const won = [0, 0];
    match.frames.forEach((_, i) => {
      const s = replayFrame(match, i);
      if (s.over) won[s.winner]++;
    });
    return won;
  }

  /** Breaks alternate rack by rack (WPA 1.3). */
  function nextFrame(match) {
    const last = match.frames[match.frames.length - 1];
    return { ...match, frames: [...match.frames, { breaker: 1 - last.breaker, events: [] }] };
  }
  return { SOLIDS, STRIPES, ALL, COLOUR, groupOf, colourOf, GROUP_WORDS, OTHER_FOULS, newMatch, startFrame, playable, groupFor, left, targets, judge, optionsFor, apply, replayFrame, framesWon, nextFrame };
})();
// ---- end engines ----

export const _test = { cleanEvent, cleanName, randomId };
