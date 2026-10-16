// The rules of snooker as a tiny state machine. A frame is a list of events; the state is
// whatever those events add up to, so undo is just "drop the last event and replay".
// Pure functions only: no DOM, no storage. Tested in tests/engine.test.mjs.

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
    respot: false, // re-spotted black (scores were level after the final black)
    toss: false, // waiting for a coin toss to decide who plays the re-spotted black
    over: false,
    winner: null,
    conceded: null,
    log: [], // the shared list of everything that happened
  };
}

/** The balls the player at the table may legally pot right now. */
export function ballsOn(s) {
  if (s.over || s.toss) return [];
  if (s.phase === "red") return s.free ? BALLS.slice() : ["red"];
  if (s.phase === "colour") return COLOURS.slice();
  return s.free ? COLOURS.slice(s.next) : [COLOURS[s.next]];
}

/** Value of "the ball on" for a foul: the red, the called colour (7 if none was called), or the next colour. */
export function valueOn(s, called) {
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
    if (ball !== "red") return { ok: true, pts: VALUE[ball] };
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
  if (f.kind === "seven") return { pen: 7, why: "a 7-point foul" };
  const parts = [{ v: 4, why: "the minimum" }];
  const on = valueOn(s, f.called);
  if (s.phase === "colour" && !f.called) parts.push({ v: 7, why: "no colour called, so it counts as 7" });
  else if (s.phase === "red") parts.push({ v: 1, why: "the red" });
  else {
    const name = s.phase === "colour" ? f.called : COLOURS[s.next];
    parts.push({ v: on, why: `the ${name}, the ball on` });
  }
  if (f.hit && f.hit !== "white") parts.push({ v: VALUE[f.hit], why: `the ${f.hit} it involved` });
  for (const c of f.colours || []) parts.push({ v: VALUE[c], why: `the ${c} potted` });
  if (f.reds) parts.push({ v: 1, why: "the red potted" });
  const top = parts.reduce((a, b) => (b.v > a.v ? b : a));
  return { pen: Math.min(7, top.v), why: top.v === 4 ? "4 is the minimum" : `value of ${top.why}` };
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
};

/** Apply one event and return the new state. Throws on an event the rules don't allow here. */
export function apply(prev, e) {
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
      const snap = { reds: s.reds, phase: s.phase, next: s.next, inHand: s.inHand, free: s.free, lastRed: s.lastRed };
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
      s.free = false;
      s.lastRed = e.t === "replace" ? snap.lastRed : false;
      s.turn = by;
      s.foul = null;
      s.log.push({ t: e.t, p: by });
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
