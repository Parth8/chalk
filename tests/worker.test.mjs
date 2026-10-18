import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker, { _test } from "../worker/worker.js";
import { FakeD1 } from "./helpers/d1.mjs";
import { workerWithEngine } from "../tools/sync-engine.mjs";

const ORIGIN = "https://parth8.github.io";
const setup = () => ({ DB: new FakeD1(), ALLOWED_ORIGINS: ORIGIN });

async function call(env, method, path, body, origin = ORIGIN) {
  const headers = { "CF-Connecting-IP": `10.0.0.${Math.floor(Math.random() * 250)}` };
  if (origin) headers.Origin = origin;
  if (body) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** A game with both sides in. Returns ids, keys and who breaks. */
async function game(env, reds = 15) {
  const made = await call(env, "POST", "/api/games", { reds });
  const id = made.body.id;
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "Asha" });
  const b = await call(env, "POST", `/api/games/${id}/join`, { name: "Team Ben" });
  const breaker = b.body.game.frames[0].breaker;
  const tok = [a.body.token, b.body.token];
  let v = b.body.v;
  const act = async (seat, e, at = v) => {
    const r = await call(env, "POST", `/api/games/${id}/act`, { token: tok[seat], v: at, e });
    if (r.status === 200) v = r.body.v;
    return r;
  };
  return { id, tok, breaker, act, get v() { return v; } };
}

test("the Worker carries an exact copy of the rules engine", () => {
  const src = readFileSync(new URL("../worker/worker.js", import.meta.url), "utf8");
  assert.equal(src, workerWithEngine(src), "run `npm run worker` to copy the engines into the Worker");
});

test("no invisible characters hide in the source (they vanish when pasted into the dashboard)", () => {
  const root = new URL("../", import.meta.url);
  const files = ["worker/worker.js", ...readdirSync(new URL("js/", root), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`)];
  assert.ok(files.length > 10);
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/, file);
});

test("health, origin check, and not-found", async () => {
  const env = setup();
  assert.deepEqual((await call(env, "GET", "/api/health")).body, { ok: true, db: true });
  assert.equal((await call(env, "POST", "/api/games", { reds: 15 }, "https://evil.example")).status, 403);
  assert.equal((await call(env, "POST", "/api/games", { reds: 15 }, null)).status, 403);
  assert.equal((await call(env, "GET", "/api/games/abcdefghjk")).status, 404);
  assert.equal((await call({ ALLOWED_ORIGINS: ORIGIN }, "POST", "/api/games", {})).status, 503);
});

test("create, join twice (coin toss), then the game is full; keys never leave the Worker", async () => {
  const env = setup();
  const made = await call(env, "POST", "/api/games", { reds: 6 });
  assert.equal(made.status, 201);
  assert.match(made.body.id, /^[a-z2-9]{10}$/);
  const id = made.body.id;
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "  Asha\u202e  " });
  assert.equal(a.body.seat, 0);
  assert.match(a.body.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.body.game.players, ["Asha", null]);
  assert.deepEqual(a.body.game.frames, []);
  const b = await call(env, "POST", `/api/games/${id}/join`, { name: "Ben" });
  assert.equal(b.body.seat, 1);
  assert.equal(b.body.game.frames.length, 1);
  assert.ok([0, 1].includes(b.body.game.frames[0].breaker));
  assert.equal(b.body.game.reds, 6);
  const c = await call(env, "POST", `/api/games/${id}/join`, { name: "Cat" });
  assert.equal(c.status, 409);
  assert.equal(c.body.error, "full");
  const seen = await call(env, "GET", `/api/games/${id}`);
  assert.doesNotMatch(JSON.stringify(seen.body), /token|keys|[0-9a-f]{64}/);
  const same = await call(env, "GET", `/api/games/${id}?v=${seen.body.v}`);
  assert.deepEqual(same.body, { v: seen.body.v, same: true });
  assert.equal(seen.headers.get("Cache-Control"), "no-store");
  assert.equal((await call(env, "POST", `/api/games/${id}/join`, { name: "   " })).status, 400);
});

test("only the side at the table can score; the other side can't touch it", async () => {
  const env = setup();
  const g = await game(env);
  const at = g.breaker;
  const other = 1 - at;
  const no = await g.act(other, { t: "pot", ball: "red" });
  assert.equal(no.status, 403);
  assert.equal(no.body.error, "not_your_turn");
  assert.equal((await g.act(other, { t: "foul", kind: "touch" })).status, 403, "can't give yourself points by calling their foul");
  assert.equal((await g.act(other, { t: "miss" })).status, 403);
  const ok = await g.act(at, { t: "pot", ball: "red" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.game.frames[0].events, [{ t: "pot", ball: "red", by: at }]);
  assert.equal((await g.act(at, { t: "pot", ball: "black" })).status, 200);
  assert.equal((await g.act(other, { t: "undo" })).status, 403, "can't undo the other side's pot");
  assert.equal((await g.act(at, { t: "undo" })).status, 200);
  assert.equal((await g.act(at, { t: "pot", ball: "blue" })).status, 200);
});

test("after a foul only the incoming side chooses; concede is only ever for yourself", async () => {
  const env = setup();
  const g = await game(env);
  const off = g.breaker;
  const inc = 1 - off;
  const f = await g.act(off, { t: "foul", kind: "white", white: true });
  assert.equal(f.status, 200);
  assert.equal((await g.act(off, { t: "again" })).status, 403, "the offender can't choose");
  assert.equal((await g.act(inc, { t: "again" })).status, 200);
  const c = await g.act(off, { t: "concede", who: inc });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.game.frames[0].events.at(-1), { t: "concede", who: off, by: off }, "who is always the side that asked");
  const n = await g.act(inc, { t: "next" });
  assert.equal(n.status, 200);
  assert.equal(n.body.game.frames.length, 2);
  assert.equal(n.body.game.frames[1].breaker, inc);
});

test("stale views, illegal moves, junk and bad keys are refused", async () => {
  const env = setup();
  const g = await game(env);
  const at = g.breaker;
  const stale = await g.act(at, { t: "pot", ball: "red" }, g.v - 1);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "stale");
  assert.ok(stale.body.game, "the current game comes back with a stale answer");
  assert.equal((await g.act(at, { t: "pot", ball: "pink" })).status, 409, "colour while on a red");
  assert.equal((await g.act(at, { t: "pot", ball: "purple" })).status, 400);
  assert.equal((await g.act(at, { t: "foul", kind: "touch", reds: 99 })).status, 400);
  assert.equal((await g.act(at, { t: "foul", kind: "touch", colours: ["pink", "pink"] })).status, 400);
  assert.equal((await g.act(at, { t: "sneaky" })).status, 400);
  const bad = await call(env, "POST", `/api/games/${g.id}/act`, { token: "f".repeat(64), v: g.v, e: { t: "miss" } });
  assert.equal(bad.status, 401);
  const r = await g.act(at, { t: "pot", ball: "red", by: 1 - at, scores: [99, 0], extra: "yes" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.game.frames[0].events.at(-1), { t: "pot", ball: "red", by: at }, "extra fields are dropped and by comes from the key");
});

test("clean names and moves", () => {
  assert.equal(_test.cleanName("  Team\u200b  Pink \n"), "Team Pink");
  assert.equal(_test.cleanName("x".repeat(40)).length, 24);
  assert.equal(_test.cleanName("José Ünal पार्थ"), "José Ünal पार्थ", "accents and Indian scripts survive");
  assert.equal(_test.cleanName("\u202eevil\u2066"), "evil", "direction tricks are removed");
  assert.throws(() => _test.cleanName(""));
  assert.deepEqual(_test.cleanEvent({ t: "foul", kind: "wrong-pot", colours: ["blue"], reds: 0, white: false, called: null }), { t: "foul", kind: "wrong-pot", colours: ["blue"] });
  const ids = new Set(Array.from({ length: 200 }, () => _test.randomId()));
  assert.equal(ids.size, 200);
});

test("calls come only from the side at the table, and set the penalty", async () => {
  const env = setup();
  const g = await game(env);
  const at = g.breaker;
  await g.act(at, { t: "pot", ball: "red" });
  assert.equal((await g.act(1 - at, { t: "call", ball: "pink" })).status, 403);
  assert.equal((await g.act(at, { t: "call", ball: "purple" })).status, 400);
  assert.equal((await g.act(at, { t: "call", ball: "pink" })).status, 200);
  assert.equal((await g.act(at, { t: "pot", ball: "blue" })).status, 409, "not the called colour");
  const r = await g.act(at, { t: "pot", ball: "pink" });
  assert.equal(r.status, 200);
});

test("restarting needs both sides: one asks, the other agrees or says no", async () => {
  const env = setup();
  const g = await game(env);
  const at = g.breaker;
  await g.act(at, { t: "pot", ball: "red" });
  let r = await g.act(at, { t: "restart" });
  assert.deepEqual(r.body.game.frames[0].ask, { by: at, all: false });
  assert.equal(r.body.game.frames[0].events.length, 1, "asking alone changes nothing");
  r = await g.act(at, { t: "restart" });
  assert.equal(r.body.game.frames[0].events.length, 1, "asking twice doesn't count as agreeing");
  r = await g.act(1 - at, { t: "restart-no" });
  assert.equal(r.body.game.frames[0].ask, undefined);
  await g.act(1 - at, { t: "restart" });
  r = await g.act(at, { t: "restart" });
  assert.deepEqual(r.body.game.frames[0], { breaker: at, events: [], restarts: 1 }, "the other side agreed: frame wiped (and counted, so phones set up again)");
  // whole game: two frames back to one
  await g.act(at, { t: "concede" });
  await g.act(at, { t: "next" });
  await g.act(1 - at, { t: "restart", all: true });
  r = await g.act(at, { t: "restart", all: true });
  assert.deepEqual(r.body.game.frames, [{ breaker: at, events: [], restarts: 2 }]);
  assert.equal((await g.act(at, { t: "restart-no" })).status, 409, "nothing to cancel");
});

test("8-ball games: made, joined and checked with the pool rules", async () => {
  const env = setup();
  const made = await call(env, "POST", "/api/games", { game: "pool" });
  assert.equal(made.body.game.kind, "pool");
  const id = made.body.id;
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "Asha" });
  const b = await call(env, "POST", `/api/games/${id}/join`, { name: "Ben" });
  assert.equal(b.body.game.kind, "pool");
  const tok = [a.body.token, b.body.token];
  let v = b.body.v;
  const at = b.body.game.frames[0].breaker;
  const act = async (seat, e) => {
    const r = await call(env, "POST", `/api/games/${id}/act`, { token: tok[seat], v, e });
    if (r.status === 200) v = r.body.v;
    return r;
  };
  assert.equal((await act(1 - at, { t: "shot", potted: [3], rail: true })).status, 403, "only the breaker breaks");
  assert.equal((await act(at, { t: "shot", potted: [3, 3], rail: true })).status, 400, "no duplicate balls");
  assert.equal((await act(at, { t: "shot", potted: [16], rail: true })).status, 400);
  assert.equal((await act(at, { t: "pot", ball: "red" })).status, 400, "snooker moves don't fit pool");
  // illegal break: the other side chooses
  let r = await act(at, { t: "shot", potted: [], rail: false });
  assert.equal(r.status, 200);
  assert.equal((await act(at, { t: "choose", opt: "accept" })).status, 403, "the breaker doesn't choose");
  assert.equal((await act(1 - at, { t: "choose", opt: "spot8" })).status, 409, "not an option here");
  r = await act(1 - at, { t: "choose", opt: "rerack-them" });
  assert.equal(r.status, 200);
  // legal break, then the other side's open table: pot a stripe and they're stripes
  await act(at, { t: "shot", potted: [], rail: true });
  r = await act(1 - at, { t: "shot", first: 12, potted: [12], rail: true, junk: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.game.frames[0].events.at(-1), { t: "shot", first: 12, potted: [12], rail: true, by: 1 - at }, "extra fields dropped");
  assert.equal((await act(1 - at, { t: "shot", first: 8, potted: [8], rail: true, eight: "called" })).status, 200, "the 8 too early is legal to log: it loses");
  const g = await call(env, "GET", `/api/games/${id}`);
  const s = (await import("../js/pool/engine.js")).replayFrame({ frames: g.body.game.frames });
  assert.equal(s.over, true);
  assert.equal(s.winner, at);
});

test("a database from before pool gets the kind column, and old games stay snooker", async () => {
  const env = setup();
  env.DB.db.exec("CREATE TABLE games (id TEXT PRIMARY KEY, v INTEGER NOT NULL, reds INTEGER NOT NULL, names TEXT NOT NULL, keys TEXT NOT NULL, frames TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)");
  env.DB.db.exec(`INSERT INTO games VALUES ('abcdefghjk', 1, 15, '["A",null]', '[null,null]', '[]', 0, ${Date.now()})`);
  const r = await call(env, "GET", "/api/games/abcdefghjk");
  assert.equal(r.status, 200);
  assert.equal(r.body.game.kind, "snooker");
  assert.equal(r.body.game.target, 0, "and the meta column (match length, teams) is added too");
  assert.deepEqual(r.body.game.teams, [null, null]);
  assert.equal((await call(env, "POST", "/api/games", { game: "pool" })).body.game.kind, "pool");
});

test("best-of matches: the length is kept, and there's no next game once someone has won", async () => {
  const env = setup();
  assert.equal((await call(env, "POST", "/api/games", { reds: 6, target: 9 })).body.game.target, 0, "only best of 3, 5 or 7");
  const made = await call(env, "POST", "/api/games", { reds: 6, target: 2 });
  assert.equal(made.body.game.target, 2);
  const id = made.body.id;
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "Asha" });
  const b = await call(env, "POST", `/api/games/${id}/join`, { name: "Ben" });
  let v = b.body.v;
  const act = async (token, e) => {
    const r = await call(env, "POST", `/api/games/${id}/act`, { token, v, e });
    if (r.status === 200) v = r.body.v;
    return r;
  };
  assert.equal((await act(b.body.token, { t: "concede" })).status, 200);
  assert.equal((await act(a.body.token, { t: "next" })).status, 200, "1–0: the match goes on");
  await act(b.body.token, { t: "concede" });
  const r = await act(a.body.token, { t: "next" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "match_over", "2–0 in a best of 3");
});

test("doubles: a side joins with its team, and teams are checked", async () => {
  const env = setup();
  const id = (await call(env, "POST", "/api/games", { game: "pool" })).body.id;
  for (const team of [["Asha"], ["A", "B", "C", "D", "E"], "Asha & Ben", [" ", "Ben"]]) {
    assert.equal((await call(env, "POST", `/api/games/${id}/join`, { name: "Asha & Ben", team })).status, 400, JSON.stringify(team));
  }
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "Asha & Ben", team: ["Asha", " Ben\u202e "] });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.game.teams, [["Asha", "Ben"], null]);
  const b = await call(env, "POST", `/api/games/${id}/join`, { name: "Cat" });
  assert.deepEqual(b.body.game.teams, [["Asha", "Ben"], null], "singles on the other side");
  assert.deepEqual(b.body.game.players, ["Asha & Ben", "Cat"]);
});

test("a restart of a different kind is a new request, not agreement", async () => {
  const env = setup();
  const g = await game(env);
  const at = g.breaker;
  await g.act(at, { t: "pot", ball: "red" });
  await g.act(at, { t: "restart", all: true });
  const r = await g.act(1 - at, { t: "restart" });
  assert.equal(r.body.game.frames[0].events.length, 1, "nothing wiped");
  assert.deepEqual(r.body.game.frames[0].ask, { by: 1 - at, all: false });
});

test("invisible characters can't make an empty or disguised name", async () => {
  const env = setup();
  const id = (await call(env, "POST", "/api/games", { reds: 6 })).body.id;
  assert.equal((await call(env, "POST", `/api/games/${id}/join`, { name: "\u2060\u3164\u2800\u00ad" })).status, 400);
  const a = await call(env, "POST", `/api/games/${id}/join`, { name: "As\u2060ha" });
  assert.deepEqual(a.body.game.players, ["Asha", null]);
});
