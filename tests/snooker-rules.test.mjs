import { test } from "node:test";
import assert from "node:assert/strict";
import { QA, TOPICS, context, search, suggestions, byId } from "../js/snooker/rules.js";
import { startFrame, apply } from "../js/snooker/engine.js";

const top = (q, n = 1) => search(q, n).map((e) => e.id);

test("the questions people actually ask find the right answer first", () => {
  const cases = {
    "What if I call a colour and don't pot it? Is it ball in hand for the opponent?": "called-missed",
    "What if I pot a red with the cue ball": "red-and-white",
    "If I call a coloured ball, can I pot it by hitting a red ball": "pot-via-red",
    "what if I pot the cue ball": "pot-white",
    scratch: "pot-white",
    "potted two reds": "two-reds",
    "spot is taken": "spot-taken",
    "free ball": "free-ball",
    "scores are level": "tie",
    "who plays after a foul": "after-foul",
    "can i pot blue off the pink": "colour-plant",
    "white touching red": "touching",
    "how many points left": "points-left",
    "I missed everything": "hit-nothing",
    "do i need to hit a cushion": "cushion",
    "foul on black": "foul-black",
    "where does the pink go": "spots",
    "when do I get ball in hand": "when-in-hand",
    "can I place the white anywhere behind the baulk line": "outside-d",
    "can i move the cue ball after placing it": "move-in-hand",
    "can I shoot backwards from the D": "backwards",
    "white stopped in the D can I move it": "stopped-in-d",
    "free ball with ball in hand": "free-in-hand",
    "I potted the blue but the white went in too": "inoff-colour",
    "potted the last red and in-off": "inoff-last-red",
    "scratch on the break": "inoff-break",
    "ball jumped and came back on the table": "off-meaning",
    "ball in hand anywhere like pool": "ball-in-hand",
    "where do I place the cue ball": "place-white",
  };
  for (const [q, id] of Object.entries(cases)) assert.deepEqual(top(q), [id], q);
  assert.ok(top("called blue potted pink", 4).includes("wrong-colour"));
  assert.ok(top("Is it ball in hand for the opponent if I miss", 3).includes("ball-in-hand"));
});

test("nonsense finds nothing rather than something random", () => {
  assert.deepEqual(search("xyzzy plugh"), []);
  assert.deepEqual(search(""), []);
});

test("every answer reads well in every situation: no undefined, NaN or empty text", () => {
  const players = ["Asha", "Ben"];
  const s0 = startFrame(15, 0);
  const states = [
    null,
    s0,
    apply(s0, { t: "pot", ball: "red" }),
    apply(s0, { t: "foul", kind: "white", white: true }),
    [{ t: "pot", ball: "red" }, { t: "pot", ball: "black" }].reduce(apply, startFrame(1, 0)),
    apply(apply(s0, { t: "foul", kind: "nothing" }), { t: "free" }),
  ];
  for (const s of states) {
    const c = context(s, players);
    for (const e of QA) {
      const a = e.a(c);
      assert.equal(typeof a, "string", e.id);
      assert.ok(a.length > 20, e.id);
      assert.doesNotMatch(a, /undefined|NaN|null|\[object/, `${e.id} in phase ${s && s.phase}`);
    }
  }
});

test("answers use the real names and points", () => {
  const s = apply(startFrame(15, 0), { t: "pot", ball: "red" }); // Asha on a colour
  const c = context(s, ["Asha", "Ben"]);
  assert.match(byId("pot-white").a(c), /Ben\*\* gets/);
  assert.match(byId("pot-white").a(c), /colour you called/);
  const clear = context([{ t: "pot", ball: "red" }, { t: "pot", ball: "black" }].reduce(apply, startFrame(1, 0)), ["Asha", "Ben"]);
  assert.match(byId("pot-white").a(clear), /\*\*4 points\*\*/); // on the yellow (2), so the minimum 4
});

test("every question has a topic, unique id, and suggestions point at real questions", () => {
  const ids = new Set(QA.map((e) => e.id));
  assert.equal(ids.size, QA.length);
  for (const e of QA) assert.ok(TOPICS.includes(e.topic), e.id);
  const s0 = startFrame(15, 0);
  for (const s of [null, s0, apply(s0, { t: "pot", ball: "red" }), apply(s0, { t: "foul", kind: "touch" })])
    for (const id of suggestions(s)) assert.ok(byId(id), id);
});
