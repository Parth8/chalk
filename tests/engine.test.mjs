import { test } from "node:test";
import assert from "node:assert/strict";
import { startFrame, apply, judgePot, penalty, remaining, standing, ballsOn, newMatch, replayFrame, framesWon, nextFrame } from "../js/engine.js";

const run = (s, ...events) => events.reduce(apply, s);
const pot = (ball, extra) => (extra ? { t: "pot", ball, extra: true } : { t: "pot", ball });
const fresh = (reds = 15, breaker = 0) => startFrame(reds, breaker);

test("red then any colour, colour re-spotted, back to reds", () => {
  let s = run(fresh(), pot("red"));
  assert.equal(s.scores[0], 1);
  assert.equal(s.phase, "colour");
  assert.deepEqual(ballsOn(s), ["yellow", "green", "brown", "blue", "pink", "black"]);
  s = apply(s, pot("black"));
  assert.equal(s.scores[0], 8);
  assert.deepEqual(s.toSpot, ["black"]);
  assert.equal(s.phase, "red");
  assert.equal(s.reds, 14);
  assert.equal(s.brk, 8);
});

test("a colour while on a red is not a legal pot", () => {
  assert.deepEqual(judgePot(fresh(), "blue"), { ok: false, reason: "foul" });
  assert.throws(() => apply(fresh(), pot("blue")));
});

test("two reds in one shot both count, only after confirming", () => {
  const s = run(fresh(), pot("red"));
  assert.equal(judgePot(s, "red").extra, true);
  assert.throws(() => apply(s, pot("red")));
  const t = apply(s, pot("red", true));
  assert.equal(t.scores[0], 2);
  assert.equal(t.reds, 13);
  assert.equal(t.phase, "colour");
});

test("a red after a colour (separate shot) is not allowed as a pot", () => {
  const s = run(fresh(), pot("red"), pot("blue"), pot("red"));
  assert.equal(judgePot(apply(s, pot("pink")), "red").ok, true);
  const t = run(fresh(), pot("red"), { t: "miss" });
  assert.equal(t.phase, "red");
  assert.equal(t.turn, 1);
});

test("missing the called colour passes the turn with reds on, no points", () => {
  const s = run(fresh(), pot("red"), { t: "miss" });
  assert.equal(s.turn, 1);
  assert.equal(s.phase, "red");
  assert.deepEqual(s.scores, [1, 0]);
  assert.equal(s.inHand, false);
});

test("after the last red: one colour of choice (re-spotted), then yellow upwards", () => {
  let s = run(fresh(1), pot("red"));
  assert.equal(s.reds, 0);
  assert.equal(s.phase, "colour");
  s = apply(s, pot("pink"));
  assert.deepEqual(s.toSpot, ["pink"]);
  assert.equal(s.phase, "clear");
  assert.deepEqual(ballsOn(s), ["yellow"]);
  s = run(s, pot("yellow"), pot("green"));
  assert.deepEqual(s.toSpot, []);
  assert.deepEqual(ballsOn(s), ["brown"]);
  assert.equal(judgePot(s, "blue").ok, false);
});

test("missing the colour after the last red leaves the opponent on the yellow", () => {
  const s = run(fresh(1), pot("red"), { t: "miss" });
  assert.equal(s.phase, "clear");
  assert.deepEqual(ballsOn(s), ["yellow"]);
});

test("foul penalties: minimum 4, ball on, ball involved, called colour, uncalled = 7", () => {
  const s = fresh();
  assert.equal(penalty(s, { kind: "white" }).pen, 4);
  assert.equal(penalty(s, { kind: "wrong-first", hit: "pink" }).pen, 6);
  assert.equal(penalty(s, { kind: "wrong-pot", colours: ["blue", "green"] }).pen, 5);
  const c = apply(s, pot("red"));
  assert.equal(penalty(c, { kind: "wrong-first", hit: "red", called: "blue" }).pen, 5);
  assert.equal(penalty(c, { kind: "wrong-first", hit: "red", called: "yellow" }).pen, 4);
  assert.equal(penalty(c, { kind: "touch" }).pen, 7, "a foul before calling a colour is 7");
  assert.equal(penalty(c, { kind: "seven" }).pen, 7);
});

test("foul: points to the opponent, reds stay down, colours re-spotted, turn passes", () => {
  const s = apply(fresh(), { t: "foul", kind: "white", white: true, reds: 2, colours: ["green", "pink"] });
  assert.deepEqual(s.scores, [0, 6]);
  assert.equal(s.reds, 13);
  assert.deepEqual(s.toSpot, ["pink", "green"]);
  assert.equal(s.turn, 1);
  assert.equal(s.inHand, true);
  assert.equal(s.foul.by, 0);
  assert.equal(s.phase, "red");
});

test("a foul on the colour after a red puts the next player on a red", () => {
  const s = run(fresh(), pot("red"), { t: "foul", kind: "wrong-first", hit: "red", called: "pink" });
  assert.deepEqual(s.scores, [1, 6]);
  assert.equal(s.phase, "red");
  assert.equal(s.turn, 1);
});

test("the last red potted on a foul: next player is on the yellow", () => {
  const s = run(fresh(1), { t: "foul", kind: "white", white: true, reds: 1 });
  assert.equal(s.reds, 0);
  assert.deepEqual(ballsOn(s), ["yellow"]);
});

test("after a foul: play again, foul and a miss (put back), free ball", () => {
  const base = run(fresh(), pot("red"));
  const f = apply(base, { t: "foul", kind: "nothing", called: "black", reds: 1 });
  assert.equal(f.reds, 13);
  const again = apply(f, { t: "again" });
  assert.equal(again.turn, 0);
  assert.equal(again.phase, "red");
  assert.deepEqual(again.scores, [1, 7]);
  const put = apply(f, { t: "replace" });
  assert.equal(put.turn, 0);
  assert.equal(put.reds, 14, "balls go back as they were");
  assert.equal(put.phase, "colour");
  assert.deepEqual(put.scores, [1, 7], "penalty stays");
  const free = apply(f, { t: "free" });
  assert.equal(free.turn, 1);
  assert.equal(free.free, true);
  assert.equal(judgePot(free, "pink").free, true);
  const t = apply(free, pot("pink"));
  assert.equal(t.scores[1], 8, "free ball counts as a red");
  assert.deepEqual(t.toSpot, ["pink"]);
  assert.equal(t.phase, "colour");
  assert.equal(t.reds, 13, "no red came off");
  assert.equal(apply(t, pot("black")).scores[1], 15);
  assert.throws(() => apply(again, { t: "again" }), "only straight after a foul");
});

test("free ball in the clearance scores the ball on and is re-spotted", () => {
  let s = run(fresh(1), pot("red"), pot("black"), { t: "foul", kind: "wrong-first", hit: "green" });
  assert.equal(s.scores[1], 4);
  s = run(s, { t: "free" });
  const j = judgePot(s, "blue");
  assert.deepEqual(j, { ok: true, pts: 2, free: true });
  s = apply(s, pot("blue"));
  assert.equal(s.scores[1], 6);
  assert.deepEqual(s.toSpot, ["blue"]);
  assert.deepEqual(ballsOn(s), ["yellow"]);
});

test("frame ends on the last black, or a foul with only the black left", () => {
  // p0: red + black (8), misses. p1 clears yellow to pink (20), then pots the black: 8-27
  let s = run(fresh(1), pot("red"), pot("black"), { t: "miss" });
  s = run(s, pot("yellow"), pot("green"), pot("brown"), pot("blue"), pot("pink"));
  assert.equal(remaining(s), 7);
  assert.deepEqual(ballsOn(s), ["black"]);
  const won = apply(s, pot("black"));
  assert.equal(won.over, true);
  assert.equal(won.winner, 1);
  assert.deepEqual(won.scores, [8, 27]);

  // the same table, but p1 misses, and p0 (12 behind, needs snookers) fouls the last black
  const t = run(s, { t: "miss" });
  assert.equal(standing(t).snookers, true);
  const fouled = apply(t, { t: "foul", kind: "white", white: true });
  assert.equal(fouled.over, true);
  assert.equal(fouled.winner, 1);
  assert.deepEqual(fouled.scores, [8, 27]);
});

test("level after the final black → re-spotted black, toss, next score or foul wins", () => {
  let x = run(fresh(1), { t: "miss" }); // p1 on red
  x = run(x, pot("red"), pot("pink"), { t: "miss" }); // 0-7, p0 on yellow
  x = run(x, { t: "foul", kind: "wrong-first", hit: "pink" }); // p0 fouls: 0-13
  x = run(x, { t: "again" }); // p1 makes p0 play again
  x = run(x, pot("yellow"), pot("green"), pot("brown"), pot("blue"), pot("pink"), { t: "miss" }); // 20-13, p1 on black
  assert.deepEqual(x.scores, [20, 13]);
  x = apply(x, pot("black")); // 20-20
  assert.equal(x.over, false);
  assert.equal(x.respot, true);
  assert.equal(x.toss, true);
  assert.deepEqual(x.toSpot, ["black"]);
  assert.deepEqual(ballsOn(x), []);
  assert.throws(() => apply(x, { t: "miss" }));
  x = apply(x, { t: "toss", who: 0 });
  assert.equal(x.turn, 0);
  assert.equal(x.inHand, true);
  assert.deepEqual(ballsOn(x), ["black"]);
  const win = apply(x, pot("black"));
  assert.equal(win.over, true);
  assert.equal(win.winner, 0);
  const lose = apply(x, { t: "foul", kind: "white", white: true });
  assert.equal(lose.over, true);
  assert.equal(lose.winner, 1);
  const pass = apply(x, { t: "miss" });
  assert.equal(pass.over, false);
  assert.equal(pass.turn, 1);
});

test("points left, lead and needing snookers", () => {
  const s = fresh();
  assert.equal(remaining(s), 147);
  assert.equal(remaining(apply(s, pot("red"))), 7 + 14 * 8 + 27);
  assert.equal(remaining(fresh(10)), 107);
  assert.equal(remaining(fresh(6)), 75);
  const st = standing(apply(fresh(), { t: "foul", kind: "touch" }));
  assert.equal(st.lead, 4);
  assert.equal(st.leader, 1);
  assert.equal(st.snookers, false);
});

test("concede ends the frame for the other side", () => {
  const s = apply(fresh(), { t: "concede", who: 0 });
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
});

test("match: frames won, next frame alternates the break", () => {
  let m = newMatch({ players: ["A", "B"], reds: 6, breaker: 1 });
  m.frames[0].events.push({ t: "concede", who: 0 });
  assert.deepEqual(framesWon(m), [0, 1]);
  m = nextFrame(m);
  assert.equal(m.frames[1].breaker, 0);
  assert.equal(replayFrame(m).turn, 0);
  assert.equal(replayFrame(m).reds, 6);
});

test("break and highest break", () => {
  const s = run(fresh(), pot("red"), pot("black"), pot("red"), pot("pink"), { t: "miss" }, pot("red"), pot("black"));
  assert.deepEqual(s.best, [15, 8]);
  assert.equal(s.brk, 8);
  assert.equal(s.log.filter((l) => l.t === "pot").length, 6);
});
