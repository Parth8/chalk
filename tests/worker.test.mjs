import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.equal(src, workerWithEngine(src), "run `npm run worker` to copy js/engine.js into the Worker");
});

test("no invisible characters hide in the source (they vanish when pasted into the dashboard)", () => {
  for (const file of ["../worker/worker.js", "../js/engine.js", "../js/app.js", "../js/rules.js"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/, file);
  }
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
  assert.deepEqual(r.body.game.frames[0], { breaker: at, events: [] }, "the other side agreed: frame wiped");
  // whole game: two frames back to one
  await g.act(at, { t: "concede" });
  await g.act(at, { t: "next" });
  await g.act(1 - at, { t: "restart", all: true });
  r = await g.act(at, { t: "restart", all: true });
  assert.deepEqual(r.body.game.frames, [{ breaker: at, events: [] }]);
  assert.equal((await g.act(at, { t: "restart-no" })).status, 409, "nothing to cancel");
});
