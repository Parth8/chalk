import { test } from "node:test";
import assert from "node:assert/strict";
import { startFrame, apply, judge, targets, left, newMatch, replayFrame, framesWon, nextFrame, optionsFor, groupOf, ALL } from "../js/pool/engine.js";

const run = (s, ...events) => events.reduce(apply, s);
const shot = (o) => ({ t: "shot", rail: true, ...o });
const fresh = (breaker = 0) => startFrame(null, breaker);
// a legal break that pots nothing: player 1 comes in on an open table
const opened = () => apply(fresh(), shot({ potted: [] }));

test("the rack: 15 balls, white in hand behind the line, breaker at the table", () => {
  const s = fresh(1);
  assert.deepEqual(s.table, ALL);
  assert.equal(s.turn, 1);
  assert.equal(s.inHand, "kitchen");
  assert.equal(s.breakShot, true);
  assert.equal(groupOf(3), "solids");
  assert.equal(groupOf(12), "stripes");
  assert.equal(groupOf(8), null);
});

test("break: a ball in keeps you at the table, table stays open", () => {
  const s = apply(fresh(), shot({ potted: [3, 11] }));
  assert.equal(s.turn, 0);
  assert.equal(s.groups, null, "groups are never decided on the break");
  assert.equal(s.table.length, 13);
  assert.equal(s.breakShot, false);
});

test("break: nothing in but 4 balls to a cushion is legal; turn passes", () => {
  const s = opened();
  assert.equal(s.turn, 1);
  assert.equal(s.choice, null);
  assert.equal(s.inHand, null);
});

test("illegal break: the other player picks accept / re-rack and break / make them break again", () => {
  const s = apply(fresh(), shot({ potted: [], rail: false }));
  assert.deepEqual(s.choice, { kind: "illegal-break", by: 1, breaker: 0 });
  assert.equal(s.turn, 1);
  assert.deepEqual(optionsFor(s), ["accept", "rerack-me", "rerack-them"]);
  assert.throws(() => apply(s, shot({ first: 1 })), "must choose first");
  const accept = apply(s, { t: "choose", opt: "accept" });
  assert.equal(accept.turn, 1);
  assert.equal(accept.breakShot, false);
  const me = apply(s, { t: "choose", opt: "rerack-me" });
  assert.equal(me.breakShot, true);
  assert.equal(me.turn, 1);
  assert.deepEqual(me.table, ALL);
  const them = apply(s, { t: "choose", opt: "rerack-them" });
  assert.equal(them.turn, 0);
  assert.equal(them.breakShot, true);
});

test("scratch on the break: foul, balls stay down, ball in hand behind the line, table open", () => {
  const s = apply(fresh(), shot({ potted: [5], white: true }));
  assert.equal(s.turn, 1);
  assert.equal(s.inHand, "kitchen");
  assert.equal(s.table.includes(5), false);
  assert.equal(s.groups, null);
});

test("8 on the break: not a loss; breaker spots it and carries on, or re-breaks", () => {
  const s = apply(fresh(), shot({ potted: [8, 2] }));
  assert.equal(s.over, false);
  assert.deepEqual(s.choice, { kind: "eight-break", by: 0, breaker: 0 });
  const spot = apply(s, { t: "choose", opt: "spot8" });
  assert.equal(spot.table.includes(8), true);
  assert.equal(spot.spot8, true);
  assert.equal(spot.turn, 0);
  assert.equal(spot.table.includes(2), false);
  const again = apply(s, { t: "choose", opt: "rebreak" });
  assert.equal(again.breakShot, true);
  assert.equal(again.turn, 0);
  assert.deepEqual(again.table, ALL);
});

test("8 on the break with a scratch: the other player spots it and has the white behind the line, or re-breaks", () => {
  const s = apply(fresh(), shot({ potted: [8], white: true }));
  assert.equal(s.choice.kind, "eight-break-foul");
  assert.equal(s.turn, 1);
  const spot = apply(s, { t: "choose", opt: "spot8" });
  assert.equal(spot.inHand, "kitchen");
  assert.equal(spot.turn, 1);
  const rb = apply(s, { t: "choose", opt: "rebreak" });
  assert.equal(rb.turn, 1, "the player choosing breaks");
});

test("another break foul (ball off the table): accept the table or white behind the line", () => {
  const s = apply(fresh(), shot({ potted: [12], other: "off" }));
  assert.equal(s.choice.kind, "break-foul");
  assert.equal(s.table.includes(12), false, "it stays off");
  assert.equal(apply(s, { t: "choose", opt: "kitchen" }).inHand, "kitchen");
  assert.equal(apply(s, { t: "choose", opt: "accept" }).inHand, null);
});

test("open table: hit anything but the 8; the called ball you pot decides the groups", () => {
  const s = opened(); // player 1
  assert.equal(targets(s).includes(8), false);
  const r = judge(s, { first: 8, potted: [] , rail: true});
  assert.equal(r.result, "foul");
  assert.match(r.reasons[0], /open table you can't hit the 8 first/);
  const t = apply(s, shot({ first: 12, potted: [12] }));
  assert.deepEqual(t.groups, ["solids", "stripes"]);
  assert.equal(t.turn, 1, "keeps going");
  assert.deepEqual(left(t, 1), [9, 10, 11, 13, 14, 15]);
  // hitting a stripe to pot a solid is fine on an open table
  const u = apply(s, shot({ first: 12, potted: [4] }));
  assert.deepEqual(u.groups, ["stripes", "solids"]);
  // both groups in: say which was called
  assert.throws(() => apply(s, shot({ first: 2, potted: [2, 10] })));
  assert.deepEqual(apply(s, shot({ first: 2, potted: [2, 10], called: 10 })).groups, ["solids", "stripes"]);
  // safety on an open table keeps it open
  const safe = apply(s, shot({ first: 2, potted: [2], safety: true }));
  assert.equal(safe.groups, null);
  assert.equal(safe.turn, 0);
});

test("with groups: hit your own first, pot your own to stay on", () => {
  const s = apply(opened(), shot({ first: 1, potted: [1] })); // player 1 solids
  assert.equal(apply(s, shot({ first: 2, potted: [] })).turn, 0, "missed: turn passes");
  const wrong = judge(s, { first: 9, potted: [2], rail: true });
  assert.equal(wrong.result, "foul");
  assert.match(wrong.reasons[0], /on solids \(1–7\), but the white hit a stripe first/);
  const f = apply(s, shot({ first: 9 }));
  assert.equal(f.inHand, "anywhere");
  assert.equal(f.turn, 0);
  // potting only the opponent's ball: no foul, turn ends, ball stays down
  const theirs = apply(s, shot({ first: 2, potted: [10] }));
  assert.equal(theirs.turn, 0);
  assert.equal(theirs.inHand, null);
  assert.equal(theirs.table.includes(10), false);
  // combination: hit yours first, both go in: carry on
  assert.equal(apply(s, shot({ first: 2, potted: [2, 10] })).turn, 1);
});

test("no cushion after contact and nothing in: foul", () => {
  const s = apply(opened(), shot({ first: 1, potted: [1] }));
  const r = judge(s, { first: 3, potted: [], rail: false });
  assert.equal(r.result, "foul");
  assert.match(r.reasons[0], /no ball touched a cushion/);
});

test("scratch: ball in hand anywhere for the other player; potted balls stay down", () => {
  const s = apply(opened(), shot({ first: 1, potted: [1] }));
  const t = apply(s, shot({ first: 3, potted: [3], white: true }));
  assert.equal(t.turn, 0);
  assert.equal(t.inHand, "anywhere");
  assert.equal(t.table.includes(3), false);
});

function onTheEight() {
  // player 1 solids, pots 1-7 one by one
  let s = apply(opened(), shot({ first: 1, potted: [1] }));
  for (const n of [2, 3, 4, 5, 6, 7]) s = apply(s, shot({ first: n, potted: [n] }));
  return s;
}

test("the 8: only once your group is down, in the pocket you called", () => {
  const s = onTheEight();
  assert.deepEqual(targets(s), [8]);
  const win = apply(s, shot({ first: 8, potted: [8], eight: "called" }));
  assert.equal(win.over, true);
  assert.equal(win.winner, 1);
  assert.equal(win.how, "potted the 8");
  const wrongPocket = apply(s, shot({ first: 8, potted: [8], eight: "wrong" }));
  assert.equal(wrongPocket.winner, 0);
  assert.equal(wrongPocket.how, "potted the 8 in the wrong pocket");
  const scratch = apply(s, shot({ first: 8, potted: [8], white: true, eight: "called" }));
  assert.equal(scratch.winner, 0, "8 in with a scratch loses");
  // scratch while playing the 8 without potting it is just a foul (WPA)
  const plain = apply(s, shot({ first: 8, potted: [], white: true }));
  assert.equal(plain.over, false);
  assert.equal(plain.inHand, "anywhere");
});

test("the 8 too early loses: before your group is down, or with your last ball", () => {
  const s = apply(opened(), shot({ first: 1, potted: [1] }));
  const early = apply(s, shot({ first: 2, potted: [8], eight: "called" }));
  assert.equal(early.over, true);
  assert.equal(early.winner, 0);
  let t = s;
  for (const n of [2, 3, 4, 5, 6]) t = apply(t, shot({ first: n, potted: [n] }));
  const together = apply(t, shot({ first: 7, potted: [7, 8], eight: "called" }));
  assert.equal(together.winner, 0);
  assert.equal(together.how, "potted the 8 too early");
  const off = apply(s, shot({ first: 2, potted: [8], other: "off" }));
  assert.equal(off.how, "drove the 8 off the table");
});

test("concede, match counting, breaks alternate", () => {
  let m = newMatch({ players: ["A", "B"], breaker: 1 });
  assert.equal(m.game, "pool");
  m.frames[0].events.push({ t: "concede", who: 1 });
  assert.deepEqual(framesWon(m), [1, 0]);
  m = nextFrame(m);
  assert.equal(replayFrame(m).turn, 0);
});

test("illegal pots aren't possible: unknown balls ignored, nothing after the rack is over", () => {
  const s = onTheEight();
  const w = apply(s, shot({ first: 8, potted: [8], eight: "called" }));
  assert.throws(() => apply(w, shot({ first: 9 })));
  assert.throws(() => apply(w, { t: "choose", opt: "accept" }));
});
