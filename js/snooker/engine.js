// The rules of snooker as a tiny state machine. A frame is a list of events; the state is
// whatever those events add up to, so undo is just "drop the last event and replay".
// Pure functions only: no DOM, no storage. Tested in tests/snooker.test.mjs.

export const VALUE = { red: 1, yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };
export const COLOURS = ["yellow", "green", "brown", "blue", "pink", "black"];
export const BALLS = ["red", ...COLOURS];
export const NAME = { red: "red", yellow: "yellow", green: "green", brown: "brown", blue: "blue", pink: "pink", black: "black", white: "white" };

/** Points still on the table in a full clearance from a given colour onwards (yellow 27 … black 7). */
const fromColour = (i) => COLOURS.slice(i).reduce((t, c) => t + VALUE[c], 0);

export function newMatch({ players = ["Player 1", "Player 2"], reds = 15, breaker = 0 } = {}) {
  return { v: 1, players: players.slice(0, 2), reds, frames: [{ breaker, events: [] }] };
}

export function startFrame(reds, breaker) {
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
export const playable = (s) => !s.over && !s.toss;

/** The balls the player at the table may legally pot right now. */
export function ballsOn(s) {
  if (s.over || s.toss) return [];
  if (s.phase === "red") return s.free ? BALLS.slice() : ["red"];
  if (s.phase === "colour") return COLOURS.slice();
  return s.free ? COLOURS.slice(s.next) : [COLOURS[s.next]];
}

/** Value of "the ball on" for a foul: the red, the called colour (7 if none was called), or the next colour. */
export function valueOn(s, called = s.called) {
  if (s.phase === "red") return 1;
  if (s.phase === "colour") return called ? VALUE[called] : 7;
  return VALUE[COLOURS[s.next]];
}

/** Points left for the player at the table, if they cleared up (counts the colour after a red). */
export function remaining(s) {
  if (s.over) return 0;
  if (s.phase === "red") return s.reds * 8 + 27;
  if (s.phase === "colour") return 7 + s.reds * 8 + 27;
  return fromColour(s.next);
}

export const maxBreak = (reds) => reds * 8 + 27;

/**
 * Would potting this ball be legal now? Returns
 *   { ok: true, pts, free?, extra? }   free: it's the free ball · extra: a second red in the same shot (ask first)
 *   { ok: false, reason }              reason: "over" | "toss" | "none" (no reds left) | "foul"
 */
export function judgePot(s, ball) {
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
export function penalty(s, f = {}) {
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
  s.toSpot = []; // the game's over: nothing goes back on the table
}

const endVisit = (s) => {
  s.brk = 0;
  s.lastRed = false;
  s.free = false;
  s.called = null;
};

/** Apply one event and return the new state. Throws on an event the rules don't allow here. */
export function apply(prev, e) {
  const s = structuredClone(prev);
  const spotting = s.toSpot;
  s.toSpot = [];
  switch (e.t) {
    case "pot": {
      const j = judgePot(s, e.ball);
      if (!j.ok) throw new Error(`illegal pot: ${e.ball} (${j.reason})`);
      if (j.extra && !e.extra) throw new Error("second red needs confirming");
      if (e.respot && !s.free) throw new Error("only a free ball comes back with the ball on");
      if (e.extra) s.toSpot = spotting; // the same shot as the last pot: whatever it put back still goes back
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
      // free ball and ball on both down in the same shot: only the ball on scores; the free ball comes back
      if (e.respot) s.toSpot = byValue([...s.toSpot, ...e.respot]);
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
      // "foul and a miss" only fits when the white failed to hit the ball on first
      const onNow = s.phase === "colour" && (s.called || e.called) ? [s.called || e.called] : firstOn(s);
      const missable = !e.hit || !onNow.includes(e.hit);
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
      s.foul = { by, pen, why, snap, missable };
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
      s.lastRed = false; // either way it's a new stroke, so a red now isn't part of an earlier shot
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
export function firstOn(s) {
  if (s.phase === "colour") return s.called ? [s.called] : COLOURS.slice();
  return ballsOn(s);
}

const ON_WORDS = (s) =>
  s.phase === "red" ? "a red" : s.phase === "colour" ? (s.called ? `the ${s.called} (your call)` : "a colour") : `the ${COLOURS[s.next]}`;

/** Fouls that aren't about which ball was hit or what went in. */
export const OTHER_FOULS = {
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
export function judgeShot(s, shot) {
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
  if (freeBall && s.phase === "clear" && colours.includes(COLOURS[s.next])) {
    // the free ball and the ball on both went in: only the ball on scores, and the free ball comes back
    const ball = COLOURS[s.next];
    const pot = { t: "pot", ball };
    if (colours.includes(first)) pot.respot = [first];
    return { result: "pot", events: [pot], reasons: [], pts: VALUE[ball] };
  }
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

export function replayFrame(match, i = match.frames.length - 1) {
  const f = match.frames[i];
  return f.events.reduce(apply, startFrame(match.reds, f.breaker));
}

/** Frames won by each player (finished frames only). */
export function framesWon(match) {
  const won = [0, 0];
  match.frames.forEach((_, i) => {
    const s = replayFrame(match, i);
    if (s.over) won[s.winner]++;
  });
  return won;
}

export function nextFrame(match) {
  const last = match.frames[match.frames.length - 1];
  return { ...match, frames: [...match.frames, { breaker: 1 - last.breaker, events: [] }] };
}

/** Lead and whether the player behind needs snookers (their deficit is more than what's left). */
export function standing(s) {
  const [a, b] = s.scores;
  const lead = Math.abs(a - b);
  const leader = a === b ? null : a > b ? 0 : 1;
  const left = remaining(s);
  return { lead, leader, left, snookers: leader !== null && !s.over && lead > left };
}
