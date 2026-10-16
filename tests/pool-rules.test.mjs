import { test } from "node:test";
import assert from "node:assert/strict";
import { QA, TOPICS, context, search, suggestions, byId } from "../js/pool-rules.js";
import { startFrame, apply } from "../js/pool.js";

test("pool questions people ask find the right answer first", () => {
  const cases = {
    "what if I scratch on the 8": "p-8-scratch",
    "what happens if the 8 ball goes in on the break": "p-break-8",
    "what is an open table": "p-open",
    "how do I get solids or stripes": "p-choose",
    "can I hit the 8 first when the table is open": "p-open-8",
    "where do I put the cue ball with ball in hand": "p-in-hand",
    "what if I pot my opponent's ball": "p-their-ball",
    "do I have to call my pocket": "p-call",
    "what is a legal break": "p-break-legal",
    "how do I rack": "p-rack",
    "three fouls in a row": "p-three",
    "what if the 8 goes in the wrong pocket": "p-8-pocket",
    "pot my last ball and the 8 together": "p-8-last",
    "does a ball need to hit a rail": "p-rail",
    "scratch on the break": "p-break-scratch",
    "is this billiards": "p-names",
    "what is the kitchen": "p-kitchen",
    "we play red and yellow balls": "p-uk",
  };
  for (const [q, id] of Object.entries(cases)) assert.deepEqual(search(q, 1).map((e) => e.id), [id], q);
});

test("every pool answer reads well in every situation", () => {
  const s0 = startFrame(null, 0);
  const open = apply(s0, { t: "shot", potted: [], rail: true });
  const solids = apply(open, { t: "shot", first: 1, potted: [1], rail: true });
  let eight = solids;
  for (const n of [2, 3, 4, 5, 6, 7]) eight = apply(eight, { t: "shot", first: n, potted: [n], rail: true });
  const foul = apply(solids, { t: "shot", first: 9, potted: [], rail: true });
  for (const s of [null, s0, open, solids, eight, foul]) {
    const c = context(s, ["Asha", "Ben"]);
    for (const e of QA) {
      const a = e.a(c);
      assert.ok(a.length > 20, e.id);
      assert.doesNotMatch(a, /undefined|NaN|null|\[object/, e.id);
    }
    for (const id of suggestions(s)) assert.ok(byId(id), id);
  }
  assert.equal(new Set(QA.map((e) => e.id)).size, QA.length);
  for (const e of QA) assert.ok(TOPICS.includes(e.topic), e.id);
});

test("answers name the player and their group", () => {
  const solids = apply(apply(startFrame(null, 0), { t: "shot", potted: [], rail: true }), { t: "shot", first: 1, potted: [1], rail: true });
  const c = context(solids, ["Asha", "Ben"]);
  assert.match(byId("p-wrong-first").a(c), /one of your solids/);
  assert.match(byId("p-after-foul").a(c), /Asha/);
});
