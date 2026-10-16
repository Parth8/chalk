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

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const ALL = [...SOLIDS, 8, ...STRIPES];
export const COLOUR = { 1: "yellow", 2: "blue", 3: "red", 4: "purple", 5: "orange", 6: "green", 7: "maroon", 8: "black" };
export const groupOf = (n) => (n === 8 ? null : n < 8 ? "solids" : "stripes");
export const colourOf = (n) => COLOUR[n > 8 ? n - 8 : n];
const GROUP = { solids: SOLIDS, stripes: STRIPES };
export const GROUP_WORDS = { solids: "solids (1–7)", stripes: "stripes (9–15)" };

export const OTHER_FOULS = {
  touch: "Touched a ball with the hand, cue or clothes",
  push: "Push or double hit (the tip stayed on the white, or hit it twice)",
  feet: "Both feet off the floor",
  moving: "Played before the balls stopped",
  placement: "With the white in hand behind the line: played it from past the line, or hit a ball behind the line first without crossing it",
  off: "A ball flew off the table (it stays off)",
};

export function newMatch({ players = ["Player 1", "Player 2"], breaker = 0 } = {}) {
  return { v: 1, game: "pool", players: players.slice(0, 2), frames: [{ breaker, events: [] }] };
}

export function startFrame(_, breaker) {
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
export const playable = (s) => !s.over && !s.choice;

/** The group a player is on, or null while the table is open. */
export const groupFor = (s, p) => (s.groups ? s.groups[p] : null);

/** Balls of a player's group still on the table. */
export function left(s, p) {
  const g = groupFor(s, p);
  return g ? GROUP[g].filter((n) => s.table.includes(n)) : null;
}

/** What the white may hit first right now. */
export function targets(s, p = s.turn) {
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
export function judge(s, shot) {
  const potted = [...new Set(shot.potted || [])].filter((n) => s.table.includes(n));
  const white = !!shot.white;
  const other = shot.other || null;
  const reasons = [];
  const shooter = s.turn;

  if (s.breakShot) {
    const fouled = white || !!other;
    if (potted.includes(8)) {
      if (fouled) {
        if (white) reasons.push("The white went in (or off the table).");
        if (other) reasons.push(`${OTHER_FOULS[other]}.`);
        reasons.push("The 8 went in on a foul break. It isn't a loss on the break.");
        return { result: "choice", choice: "eight-break-foul", reasons };
      }
      return { result: "choice", choice: "eight-break", reasons: ["The 8 went in on the break. That's not a foul and not a loss."] };
    }
    if (!potted.length && !shot.rail && !white) {
      reasons.push("Nothing went in and fewer than 4 balls hit a cushion: an illegal break.");
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
    if (!eightOn) return { result: "loss", reasons: [`The 8 went in before ${g ? `all the ${g}` : "a group"} ${g ? "were" : "was"} down.`], how: "potted the 8 too early" };
    if (potted.some((n) => n !== 8 && groupOf(n) === g)) return { result: "loss", reasons: ["The 8 went in on the same shot as one of your own balls. It has to be the last ball you pot."], how: "potted the 8 too early" };
    if (shot.eight !== "called") return { result: "loss", reasons: ["The 8 went in a pocket you didn't call."], how: "potted the 8 in the wrong pocket" };
    return { result: "win", reasons: ["The 8 went in the pocket you called."], how: "potted the 8" };
  }
  if (reasons.length) return { result: "foul", reasons };

  if (!potted.length) return { result: "pass", reasons: ["A fair shot: the white hit the right ball first and a ball touched a cushion. Nothing went in, so it's the other player's turn."] };
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
};
export const optionsFor = (s) => (s.choice ? OPTIONS[s.choice.kind] : []);

/** Apply one event and return the new state. Throws on an event the rules don't allow here. */
export function apply(prev, e) {
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
        s.choice = { kind: r.choice, by: breakerDecides ? p : 1 - p, breaker: p };
        s.turn = s.choice.by;
      }
      return s;
    }
    case "choose": {
      if (!s.choice || !optionsFor(s).includes(e.opt)) throw new Error("nothing to choose");
      const { kind, by, breaker } = s.choice;
      s.choice = null;
      s.log.push({ t: "choose", p: by, opt: e.opt, kind });
      if (e.opt === "accept") {
        s.turn = by;
        s.inHand = null;
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

export function replayFrame(match, i = match.frames.length - 1) {
  const f = match.frames[i];
  return f.events.reduce(apply, startFrame(null, f.breaker));
}

export function framesWon(match) {
  const won = [0, 0];
  match.frames.forEach((_, i) => {
    const s = replayFrame(match, i);
    if (s.over) won[s.winner]++;
  });
  return won;
}

/** Breaks alternate rack by rack (WPA 1.3). */
export function nextFrame(match) {
  const last = match.frames[match.frames.length - 1];
  return { ...match, frames: [...match.frames, { breaker: 1 - last.breaker, events: [] }] };
}
