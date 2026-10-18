// 8-ball pool's screens: the pad of numbered balls, what's on, ball in hand, the break and the
// choices after it, "What happened?", racking and putting the 8 back. The shared game screen
// (screens/game.js) calls these through the interface at the bottom, the same one snooker has.

import { SOLIDS, STRIPES, ALL, groupOf, groupFor, left, targets, judge, optionsFor, replayFrame, OTHER_FOULS, GROUP_WORDS } from "./engine.js";
import * as rules from "./rules.js";
import { poolSVG } from "./table.js";
import { h, btn, toast, cardWithPicture } from "../core/dom.js";
import { openSheet, closeSheet } from "../core/sheet.js";
import { session, act, can, changed, state, names, eventsNow, evKey, frameNo, gameKey, isShared } from "../core/session.js";
import { playerUp } from "../core/match.js";
import { lessonSheet } from "../core/lessons.js";

const rival = (g) => (g === "solids" ? "stripes" : "solids");
const up = (s, p = s.turn) => playerUp(session.match, p); // who's at the table (a player's name in doubles)

const waiting = (me) => (session.seat === null ? `${me} is at the table. Their phone logs the shots, and you'll see them here live.` : `${me} is at the table and logs this visit on their phone. You'll see each shot here live.`);

/** A small numbered ball for lists and chips. */
export const pdot = (n, cls = "pdot") => h("span", { class: cls, "data-n": String(n), "data-stripe": n > 8 ? "1" : null, "aria-hidden": "true" }, h("i", { text: String(n) }));
const white = () => h("span", { class: "pdot", "data-n": "0", "aria-hidden": "true" });

/** Pop-up progress that belongs to this phone only. */
const local = { racked: new Set(), spotDone: "" };

const onWords = (s, p = s.turn) => {
  const g = groupFor(s, p);
  if (!g) return "an open table";
  return left(s, p).length ? GROUP_WORDS[g] : "the 8";
};

/* ---------------- the players' cards and the line under them ---------------- */

function playerCard(s, p) {
  const g = groupFor(s, p);
  if (!g) return { big: "–", sub: [s.breakShot && s.turn === p ? "breaks" : "open table"], label: "open table" };
  const mine = left(s, p);
  if (!mine.length) return { big: "8", sub: ["on the 8"], extra: h("span", { class: "mini" }, pdot(8)), label: "on the 8" };
  return { big: String(mine.length), sub: [`${g} left`], extra: h("span", { class: "mini" }, mine.map((n) => pdot(n))), label: `${mine.length} ${g} left` };
}

function standingLine(s) {
  if (s.over) return [];
  const n = names();
  if (s.breakShot) return [`${up(s)} breaks`];
  if (!s.groups) return ["Open table: nobody has a group yet"];
  return [[0, 1].map((p) => `${n[p]}: ${left(s, p).length ? `${s.groups[p]}, ${left(s, p).length} left` : "on the 8"}`).join(" · ")];
}

/* ---------------- what's on, the choices after a break, ball in hand ---------------- */

const CHOICE = {
  title: {
    "illegal-break": "Illegal break",
    "eight-break": "The 8 went in on the break",
    "eight-break-foul": "The 8 went in, with a foul",
    "break-foul": "Foul on the break",
    "eight-off-break": "The 8 flew off on the break",
  },
  /** what happened, in a sentence */
  why: {
    "illegal-break": "Nothing went in and fewer than 4 balls hit a cushion.",
    "eight-break": "That's not a loss.",
    "eight-break-foul": "It isn't a loss on the break.",
    "break-foul": "The break was a foul.",
    "eight-off-break": "It isn't a loss: the 8 goes back on the foot spot.",
  },
};

function choiceLabel(opt, kind, chooser, breaker) {
  if (kind === "eight-off-break" && opt === "accept") return "Put the 8 back, play the table as it is";
  return {
    accept: "Play the table as it is",
    "rerack-me": `Re-rack, ${chooser} breaks`,
    "rerack-them": `Re-rack, ${breaker} breaks again`,
    spot8: kind === "eight-break" ? "Put the 8 back and carry on" : `Put the 8 back, ${chooser} plays from behind the line`,
    rebreak: `Re-rack, ${chooser} breaks`,
    kitchen: kind === "eight-off-break" ? "Put the 8 back, white behind the line" : "Take the white behind the line",
  }[opt];
}

/** In a choice after the break, may this phone choose? */
const canChoose = (s) => !!s.choice && (!isShared() || (session.ready && session.seat === s.choice.by));

function guide(s) {
  const cards = [];
  if (s.over) return { cards, alerts: [] };
  if (s.choice) {
    const { kind, by, breaker } = s.choice;
    const who = up(s, by);
    const text = canChoose(s) ? `${CHOICE.why[kind]} ${who} chooses what happens:` : `${CHOICE.why[kind]} Waiting for ${who} to choose on their phone.`;
    cards.push(
      h(
        "div",
        { class: "g-card foul", "data-key": `choice-${evKey()}` },
        h("p", { class: "g-kicker", text: `Game ${frameNo()}` }),
        h("p", { class: "g-title", text: CHOICE.title[kind] }),
        h("p", { class: "g-text", text }),
        canChoose(s) ? h("div", { class: "choices" }, optionsFor(s).map((o) => btn(choiceLabel(o, kind, who, up(s, breaker)), () => act({ t: "choose", opt: o }), "btn"))) : null
      )
    );
    return { cards, alerts: [] };
  }
  cards.push(onCard(s));
  return { cards, alerts: [] };
}

function onCard(s) {
  const me = up(s);
  let kicker = `${me} · at the table`;
  let title;
  let text;
  let extra = null;
  const g = groupFor(s, s.turn);
  if (s.breakShot) {
    kicker = `${me} · the break`;
    title = "Break";
    text = "White anywhere behind the line. Hit the rack hard: pot a ball, or make at least 4 balls hit a cushion. When the balls stop, tap Log the break.";
  } else if (!g) {
    title = "Open table";
    text = "Hit any ball except the 8. The first ball you pot on purpose decides your group: solids (1–7) or stripes (9–15).";
  } else if (left(s, s.turn).length) {
    title = `You're ${g} · ${left(s, s.turn).length} left`;
    text = `Hit one of your ${g} first. Pot one to keep going. Then the 8.`;
    extra = h("div", { class: "mini big" }, left(s, s.turn).map((n) => pdot(n)));
  } else {
    title = "Pot the 8 to win";
    text = "Say which pocket first. In a different pocket, or with a foul (like the white going in too), and you lose.";
    extra = h("div", { class: "mini big" }, pdot(8));
  }
  if (isShared() && !can("turn", s)) text = waiting(me); // this phone can't tap: don't tell it to
  const card = h("div", { class: "g-card", style: "--on: var(--accent)" }, h("p", { class: "g-kicker", text: kicker }), h("p", { class: "g-title", text: title }), h("p", { class: "g-text", text }), extra);
  if (!s.inHand) return card;
  // (on the break, the words above already say where the white goes)
  if (!s.breakShot) card.append(h("p", { class: "g-text" }, h("b", { text: "Ball in hand: " }), s.inHand === "kitchen" ? "put the white anywhere behind the line at your end." : "put the white anywhere on the table."));
  card.classList.add("in-hand");
  return cardWithPicture(card, poolSVG({ labels: false, [s.inHand === "kitchen" ? "kitchen" : "anywhere"]: true }));
}

/* ---------------- the pad ---------------- */

function pad(s) {
  const turn = can("turn", s);
  const ok = s.breakShot || s.choice || s.over ? [] : targets(s);
  const ball = (n) => {
    const on = s.table.includes(n);
    return h(
      "button",
      {
        type: "button",
        class: `pball${ok.includes(n) ? " on" : ""}${on ? "" : " gone"}${n === 8 ? " eight" : ""}`,
        "data-n": String(n),
        "data-stripe": n > 8 ? "1" : null,
        "aria-label": on ? `${n} ball${ok.includes(n) ? " (yours)" : ""}: it went in` : `${n} ball, already potted`,
        disabled: !turn || !on,
        on: { click: () => onBall(n) },
      },
      h("i", { text: String(n) })
    );
  };
  const rows = [h("div", { class: "prow" }, SOLIDS.map(ball)), h("div", { class: "prow" }, STRIPES.map(ball)), h("div", { class: "prow eight-row" }, ball(8))];
  return turn ? [...rows, h("p", { class: "pad-hint", text: padHint(s) })] : rows;
}

function padHint(s) {
  if (s.breakShot) return "After the break, tap Log the break (or a ball that went in).";
  const g = groupFor(s, s.turn);
  if (!g) return "Potted a ball on purpose? Tap it. Nothing went in? Missed.";
  if (!left(s, s.turn).length) return "The 8 went in? Tap it. Didn't? Missed.";
  return `One of your ${g} went in? Tap it. Nothing went in? Missed.`;
}

/**
 * A tap on a ball: one of yours (or any but the 8 on an open table) went in fairly. Each tap is
 * its own shot, so when a ball that changes the ruling (the 8, or one of theirs) is tapped right
 * after one of yours went in, first ask whether they went in on the same shot.
 */
function onBall(n) {
  const s = state();
  if (!can("turn", s) || !s.table.includes(n)) return;
  if (s.breakShot) return breakSheet([n]);
  const last = s.log[s.log.length - 1];
  const g0 = groupFor(s, s.turn);
  const plain = n !== 8 && (!g0 || groupOf(n) === g0);
  const prev = eventsNow()[eventsNow().length - 1];
  if (!plain && last && last.t === "shot" && last.p === s.turn && last.result === "continue" && !last.brk && last.potted.length && prev?.t === "shot") {
    return sameShotSheet(n, prev, last.potted);
  }
  tapped(n);
}

function sameShotSheet(n, prev, before) {
  const balls = words(before);
  openSheet(
    `The ${n} went in`,
    h("p", { class: "lead-text" }, "Did it go in on the ", h("b", { text: "same shot" }), ` as the ${balls}, or on a new shot?`),
    h("p", { class: "note", text: "It matters: for example the 8 going in with your last ball loses, and one of theirs going in with one of yours doesn't end your turn." }),
    // describe the whole shot instead; confirming it replaces the shot logged a moment ago
    btn(`Same shot as the ${balls}`, () => shotSheet({ first: prev.first, potted: [...before, n] }, `One shot: the ${words([...before, n])} went in. Check the rest and I'll rule on it.`, { replaceLast: true }), "btn primary big"),
    btn("A new shot", () => {
      closeSheet();
      tapped(n);
    }, "btn big")
  );
}

const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : String(list[0]));

function tapped(n) {
  const s = state();
  const g = groupFor(s, s.turn);
  if (n === 8) {
    if (!targets(s).includes(8)) return shotSheet({ potted: [8] }, `The 8 isn't yours to pot yet (you're on ${onWords(s)}). What happened?`);
    return eightSheet();
  }
  if (!g || groupOf(n) === g) {
    const r = judge(s, { first: n, potted: [n], rail: true });
    act({ t: "shot", first: n, potted: [n], rail: true });
    if (r.assign) toast(`${names()[s.turn]} is ${GROUP_WORDS[r.assign]}`);
    return;
  }
  shotSheet({ potted: [n] }, `The ${n} is one of ${names()[1 - s.turn]}'s ${rival(g)}. What happened?`);
}

function onMiss() {
  const s = state();
  if (s.breakShot) return breakSheet([]);
  act({ t: "shot", first: targets(s)[0], potted: [], rail: true });
}

function onWhat() {
  return state().breakShot ? breakSheet() : shotSheet();
}

/* ---------------- sheets: the break, What happened?, the 8 ---------------- */

const chip = (label, pressed, onClick, lead) => h("button", { type: "button", class: `chip${lead ? " ball-chip" : ""}`, "aria-pressed": String(pressed), on: { click: onClick } }, lead, label);

function verdictBox(s, r, events) {
  const me = up(s);
  const opp = up(s, 1 - s.turn);
  const go = (label, cls) =>
    btn(label, () => {
      closeSheet();
      for (const e of events) act(e);
    }, `btn big ${cls}`);
  const reasons = h("ul", { class: "reasons" }, r.reasons.map((x) => h("li", { text: x })));
  if (r.result === "continue") return h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `Fair: ${me} keeps going` }), reasons, go("Carry on", "primary"));
  if (r.result === "pass") return h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: `No foul: ${opp}'s turn` }), reasons, go(`${opp}'s turn`, ""));
  if (r.result === "foul")
    return h(
      "div",
      { class: "verdict foul" },
      h("p", { class: "v-title", text: `Foul: ball in hand for ${opp}` }),
      reasons,
      h("p", { text: `${opp} puts the white anywhere ${r.kitchen ? "behind the line" : "on the table"}. Balls that went in stay down.` }),
      go(`Foul: ${opp} has ball in hand`, "warn")
    );
  if (r.result === "win") return h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `${me} wins!` }), reasons, go(`${me} wins the game`, "primary"));
  if (r.result === "loss") return h("div", { class: "verdict foul" }, h("p", { class: "v-title", text: `${me} loses this game` }), reasons, go(`${opp} wins the game`, "warn"));
  const who = r.choice === "eight-break" ? me : opp;
  return h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: `${who} chooses what happens next` }), reasons, go("Show the choices", "primary"));
}

/** The break: what went in, and (if nothing) whether 4 balls hit a cushion. */
function breakSheet(prefill = []) {
  const s = state();
  const shot = { potted: new Set(prefill), white: false, rail: true, other: null };
  const body = h("div", { class: "shot" });
  const draw = () => {
    const parts = [h("p", { class: "lead-text", text: `${up(s)} broke. Tell me what happened and I'll rule on it.` })];
    const none = !shot.potted.size && !shot.white;
    parts.push(
      h("h3", { text: "1. What went in?" }),
      h(
        "div",
        { class: "chips" },
        chip("Nothing", none, () => {
          shot.potted.clear();
          shot.white = false;
          draw();
        }),
        chip("White", shot.white, () => ((shot.white = !shot.white), draw()), white()),
        ALL.filter((x) => s.table.includes(x)).map((x) => chip("", shot.potted.has(x), () => (shot.potted.has(x) ? shot.potted.delete(x) : shot.potted.add(x), draw()), pdot(x, "pdot big")))
      )
    );
    parts.push(offRow(shot, draw));
    if (!shot.potted.size)
      parts.push(
        h("h3", { text: "2. Did at least 4 balls hit a cushion?" }),
        h("div", { class: "chips" }, chip("Yes", shot.rail, () => ((shot.rail = true), draw())), chip("No", !shot.rail, () => ((shot.rail = false), draw())))
      );
    parts.push(moreFouls(s, shot, draw));
    const e = clean({ t: "shot", potted: [...shot.potted], white: shot.white, rail: shot.rail, other: shot.other });
    parts.push(verdictBox(s, judge(s, e), [e]));
    body.replaceChildren(...parts);
  };
  draw();
  openSheet("The break", body);
}

/** The game as it was before the last move (to rule on it again as part of a bigger shot). */
function stateBeforeLast() {
  const m = session.match;
  const frames = m.frames.slice();
  const i = frames.length - 1;
  frames[i] = { ...frames[i], events: frames[i].events.slice(0, -1) };
  return replayFrame({ ...m, frames });
}

/**
 * Any other shot: first contact (by group), what went in, a cushion, the 8's pocket.
 * replaceLast: the shot includes the one logged just before, which this one replaces.
 */
function shotSheet(prefill = {}, intro = "", { replaceLast = false } = {}) {
  const s = replaceLast ? stateBeforeLast() : state();
  const g = groupFor(s, s.turn);
  const ok = targets(s);
  const on = (x) => s.table.includes(x);
  const kinds = [
    ["solid", "A solid (1–7)", SOLIDS.filter(on)],
    ["stripe", "A stripe (9–15)", STRIPES.filter(on)],
    ["eight", "The 8", [8]],
  ].filter(([, , list]) => list.length);
  const legalKind = (list) => list.some((x) => ok.includes(x));
  const kindOf = (x) => (x === 8 ? "eight" : groupOf(x) === "solids" ? "solid" : "stripe");
  const shot = {
    first: prefill.first ? kindOf(prefill.first) : kinds.find(([, , list]) => legalKind(list))?.[0] || "nothing",
    potted: new Set(prefill.potted || []),
    white: false,
    rail: true,
    eight: "called",
    called: null,
    other: null,
    safety: false,
    uncalled: false,
  };
  const body = h("div", { class: "shot" });
  const draw = () => {
    const parts = [h("p", { class: "lead-text", text: intro || `Tell me what happened and I'll rule on it. ${up(s)} is on ${onWords(s)}.` })];
    parts.push(
      h("h3", { text: "1. What did the white hit first?" }),
      h(
        "div",
        { class: "chips" },
        kinds.map(([k, label, list]) => chip(legalKind(list) ? `${label} · ${g || k === "eight" ? "yours" : "allowed"}` : label, shot.first === k, () => ((shot.first = k), draw()), pdot(list[0]))),
        chip("Nothing", shot.first === "nothing", () => ((shot.first = "nothing"), draw()))
      )
    );
    const none = !shot.potted.size && !shot.white;
    parts.push(
      h("h3", { text: "2. What went in?" }),
      h(
        "div",
        { class: "chips" },
        chip("Nothing", none, () => {
          shot.potted.clear();
          shot.white = false;
          draw();
        }),
        chip("White", shot.white, () => ((shot.white = !shot.white), draw()), white()),
        ALL.filter(on).map((x) => chip("", shot.potted.has(x), () => (shot.potted.has(x) ? shot.potted.delete(x) : shot.potted.add(x), draw()), pdot(x, "pdot big")))
      )
    );
    parts.push(offRow(shot, draw));
    if (!shot.potted.size && shot.first !== "nothing")
      parts.push(
        h("h3", { text: "3. After that, did any ball touch a cushion?" }),
        h("div", { class: "chips" }, chip("Yes", shot.rail, () => ((shot.rail = true), draw())), chip("No, nothing did", !shot.rail, () => ((shot.rail = false), draw())))
      );
    if (shot.potted.has(8) && ok.includes(8) && !shot.safety && shot.other !== "off")
      parts.push(
        h("h3", { text: "Did the 8 go in the pocket you called?" }),
        h("div", { class: "chips" }, chip("Yes", shot.eight === "called", () => ((shot.eight = "called"), draw())), chip("No, another pocket", shot.eight === "wrong", () => ((shot.eight = "wrong"), draw())))
      );
    const groupsIn = new Set([...shot.potted].filter((x) => x !== 8).map(groupOf));
    if (!g && groupsIn.size > 1) {
      const pot = [...shot.potted].filter((x) => x !== 8);
      if (!pot.includes(shot.called)) shot.called = null;
      parts.push(h("h3", { text: "Which ball had you called?" }), h("div", { class: "chips" }, pot.map((x) => chip("", shot.called === x, () => ((shot.called = x), draw()), pdot(x, "pdot big")))));
    }
    parts.push(moreFouls(s, shot, draw, true));

    const list = kinds.find(([k]) => k === shot.first)?.[2] || [8];
    const firstBall = shot.first === "nothing" ? "nothing" : (list.find((x) => ok.includes(x)) ?? list[0]);
    const e = clean({ t: "shot", first: firstBall, potted: [...shot.potted], white: shot.white, rail: shot.rail, other: shot.other, eight: shot.potted.has(8) ? shot.eight : undefined, safety: shot.safety, called: shot.called, uncalled: shot.uncalled });
    const r = judge(s, e);
    parts.push(r.needCalled ? h("div", { class: "verdict" }, h("p", { text: "Pick the ball you'd called." })) : verdictBox(s, r, replaceLast ? [{ t: "undo" }, e] : [e]));
    body.replaceChildren(...parts);
  };
  draw();
  openSheet("What happened?", body);
}

/** A ball off the table is a foul (the 8 off loses), not a pot: asked on its own so it isn't missed. */
function offRow(shot, draw) {
  return h(
    "div",
    { class: "off-row" },
    h("h3", { text: "Did a numbered ball jump off the table?" }),
    h(
      "div",
      { class: "chips" },
      chip("No", shot.other !== "off", () => (shot.other === "off" && (shot.other = null), draw())),
      chip("Yes (tick it above too)", shot.other === "off", () => ((shot.other = "off"), draw()))
    )
  );
}

/** "Anything else?": the less common fouls, safety, and a called ball that didn't drop. */
function moreFouls(s, shot, draw, safety = false) {
  const list = Object.entries(OTHER_FOULS).filter(([k]) => k !== "off" && (k !== "placement" || s.inHand === "kitchen"));
  const said = shot.other && shot.other !== "off" ? `Also: ${OTHER_FOULS[shot.other].toLowerCase()}` : shot.safety ? "Also: called safety" : shot.uncalled ? "Also: the called ball didn't go in" : safety ? "Anything else? (touched a ball, double hit, safety…)" : "Anything else? (touched a ball, double hit…)";
  const d = h(
    "details",
    { class: "more" },
    h("summary", { text: said }),
    h(
      "div",
      { class: "choices" },
      list.map(([k, label]) => h("button", { type: "button", class: "choice", "aria-pressed": String(shot.other === k), on: { click: () => ((shot.other = shot.other === k ? null : k), draw()) } }, label)),
      safety ? h("button", { type: "button", class: "choice safe", "aria-pressed": String(shot.safety), on: { click: () => ((shot.safety = !shot.safety), draw()) } }, "I called safety before the shot (not a foul)") : null,
      safety ? h("button", { type: "button", class: "choice safe", "aria-pressed": String(shot.uncalled), on: { click: () => ((shot.uncalled = !shot.uncalled), draw()) } }, "A ball went in, but not the one I called (not a foul, my turn ends)") : null
    )
  );
  d.open = (!!shot.other && shot.other !== "off") || !!shot.safety || !!shot.uncalled;
  return d;
}

/** Only what the shot needs, so stored moves stay small and the Worker accepts them. */
function clean(e) {
  const out = { t: "shot" };
  if (e.first !== undefined) out.first = e.first;
  out.potted = [...new Set(e.potted)].sort((a, b) => a - b);
  if (e.white) out.white = true;
  out.rail = !!e.rail;
  if (e.other) out.other = e.other;
  if (e.eight) out.eight = e.eight;
  if (e.safety) out.safety = true;
  if (e.called) out.called = e.called;
  if (e.uncalled) out.uncalled = true;
  return out;
}

/** Tapped the 8 when it's the ball on: the pocket decides it. */
function eightSheet() {
  const s = state();
  const me = up(s);
  const pot = (eight) => {
    closeSheet();
    act({ t: "shot", first: 8, potted: [8], rail: true, eight });
  };
  openSheet(
    "The 8 went in!",
    h("p", { class: "lead-text" }, "Did it go in the pocket ", h("b", { text: me }), " called, with nothing else going wrong (the white stayed on the table)?"),
    btn(`Yes: ${me} wins`, () => pot("called"), "btn primary big"),
    btn("No, it went in a different pocket", () => pot("wrong"), "btn big"),
    btn("Something else happened (the white went in…)", () => shotSheet({ first: 8, potted: [8] }), "link")
  );
}

/* ---------------- pop-ups that must be done at the table ---------------- */

/** Racking (at the start, and after a re-rack), then putting the 8 back: { kind, key, open } or null. */
function gate(s) {
  const key = `${gameKey()}:${eventsNow().length}`;
  if (s.breakShot && !s.choice && !s.over && !local.racked.has(key)) return { kind: "setup", key, everyone: true, open: () => rackSheet(key) };
  if (s.spot8 && local.spotDone !== evKey()) return { kind: "spot", key: `spot-${evKey()}`, everyone: false, open: spotSheet };
  return null;
}

function rackSteps(breaker) {
  return h(
    "ol",
    { class: "steps" },
    h("li", {}, h("span", {}, "Put the triangle's tip on the ", h("b", { text: "foot spot" }), ", the spot at the far end.")),
    h("li", {}, h("span", {}, "Put the ", pdot(8), h("b", { text: "8" }), " in the middle of the third row.")),
    h("li", {}, h("span", {}, "In the two back corners: one ", h("b", { text: "solid" }), " and one ", h("b", { text: "stripe" }), ".")),
    h("li", {}, h("span", {}, "The rest in any order, packed tight. Lift the triangle off carefully.")),
    h("li", {}, h("span", {}, white(), h("b", { text: " White" }), ` anywhere behind the line at your end (the "kitchen").${breaker ? ` ${breaker} hits the rack hard.` : ""}`))
  );
}

function rackSheet(key) {
  const breaker = up(state());
  openSheet(
    `Game ${frameNo()}: rack the balls`,
    { locked: true, kind: "setup" },
    h("p", { class: "lead-text" }, "Put the balls out like this. ", h("b", { text: `${breaker} breaks.` })),
    h("div", { class: "table-wrap", html: poolSVG({ rack: true }) }),
    rackSteps(breaker),
    btn("The balls are racked", () => {
      local.racked.add(key);
      closeSheet();
      changed();
    }, "btn primary big"),
    btn("New to pool? How it works", () => lessonSheet(LESSONS, "How 8-ball pool works"), "link"),
    h("button", { type: "button", class: "link", "data-go": "home" }, "Not now: back to the home screen")
  );
}

function spotSheet() {
  openSheet(
    "Put the 8 back on the table",
    { locked: true, kind: "spot" },
    h("p", { class: "lead-text", text: "The 8 goes back on the foot spot, where the tip of the triangle was." }),
    h("div", { class: "table-wrap", html: poolSVG({ spot: true }) }),
    h("p", { class: "lead-text" }, h("b", { text: "If a ball is in the way, put the 8 as close as you can directly behind the spot, towards the far cushion." })),
    btn("The 8 is back on the table", () => {
      local.spotDone = evKey();
      closeSheet();
      changed();
    }, "btn primary big"),
    can("undo") ? btn("Oops, undo that choice", () => (closeSheet(), act({ t: "undo" })), "link") : null
  );
}

/* ---------------- the shared list of what happened ---------------- */

const CHOSE = { accept: "plays the table as it is", "rerack-me": "re-racks to break", "rerack-them": "re-racks for a re-break", spot8: "puts the 8 back", rebreak: "re-racks to break", kitchen: "takes the white behind the line" };

function logRows(s) {
  const n = names();
  const rows = [];
  let visit = null;
  const flush = () => visit && (rows.push(visit), (visit = null));
  for (const l of s.log) {
    if (l.t === "shot" && (l.result === "continue" || (l.result === "pass" && l.potted.length && !l.brk)) && !l.white) {
      if (!visit || visit.p !== l.p) {
        flush();
        visit = { p: l.p, balls: [], brk: false };
      }
      visit.balls.push(...l.potted);
      visit.brk ||= l.brk;
      if (l.result === "pass") flush();
      continue;
    }
    flush();
    if (l.t === "shot" && l.result === "pass") continue;
    rows.push(l);
  }
  flush();
  return rows.reverse().map((r) => {
    if (r.balls) return h("li", {}, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, r.brk ? h("small", { text: "break " }) : null, r.balls.map((x) => pdot(x))), h("span", { class: "pts", text: "" }));
    if (r.t === "shot" && r.result === "foul") return h("li", { class: "foul" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, `Foul${r.white ? " (white in)" : ""} → ball in hand`, ...r.potted.map((x) => pdot(x))), h("span", { class: "pts", text: "" }));
    if (r.t === "shot" && (r.result === "win" || r.result === "loss")) return h("li", { class: r.result === "loss" ? "foul" : "" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, r.result === "win" ? "Potted the 8: wins" : "Lost on the 8", pdot(8)), h("span", { class: "pts", text: "" }));
    if (r.t === "shot" && r.result === "choice") return h("li", { class: "info", text: `${n[r.p]}'s break: ${r.potted.includes(8) ? "the 8 went in" : "illegal or foul break"}` });
    if (r.t === "choose") return h("li", { class: "info", text: `${n[r.p]} ${CHOSE[r.opt]}` });
    if (r.t === "concede") return h("li", { class: "info", text: `${n[r.p]} gave up this game` });
    return null;
  });
}

const undoLabel = (e) => ({ choose: "the choice", concede: "give up" })[e.t] || "last shot";

/* ---------------- words for the end of a game, speech, and learning ---------------- */

function result(s) {
  const n = names();
  const w = s.winner;
  const line = s.conceded !== null ? `${n[s.conceded]} gave up this game.` : s.how === "potted the 8" ? `${n[w]} potted the 8.` : `${n[1 - w]} ${s.how}, so ${n[w]} wins.`;
  return { score: null, line, note: "" };
}

/** What the phone says when the situation changes (if spoken prompts are on). */
function announce(s) {
  if (s.over) return "";
  if (s.choice) return `${up(s, s.choice.by)}, choose what happens next.`;
  const who = up(s);
  if (s.breakShot) return `${who} to break.`;
  const hand = s.inHand ? " Ball in hand." : "";
  const g = groupFor(s, s.turn);
  if (!g) return `${who}, open table.${hand}`;
  return left(s, s.turn).length ? `${who}, ${g}.${hand}` : `${who}, the 8.${hand}`;
}

const LESSONS = [
  ["The idea", () => [h("p", {}, "Take turns hitting the ", h("b", { text: "white ball" }), " with your cue to knock the numbered balls into the pockets (", h("b", { text: "potting" }), "). There are no points: you win a game by potting the black ", h("b", { text: "8" }), " at the right moment.")]],
  [
    "Solids and stripes",
    () => [
      h("div", { class: "balls-row" }, SOLIDS.map((x) => pdot(x, "pdot big"))),
      h("div", { class: "balls-row" }, STRIPES.map((x) => pdot(x, "pdot big"))),
      h("p", {}, "One player gets the ", h("b", { text: "solids (1–7)" }), ", the other the ", h("b", { text: "stripes (9–15)" }), ". The 8 belongs to nobody."),
    ],
  ],
  ["The break", () => [h("p", {}, "Rack the balls in a triangle, put the white behind the line at your end, and hit the rack hard. Until someone pots a ball on purpose, nobody has a group (an ", h("b", { text: "open table" }), ").")]],
  ["Your turn", () => [h("p", {}, "Hit one of ", h("b", { text: "your own balls first" }), ". Pot one and you keep going. Miss, and it's the other player's turn.")]],
  ["Fouls", () => [h("p", {}, "Hit the wrong ball first, put the white in a pocket, or hit nothing? That's a ", h("b", { text: "foul" }), ": the other player gets ", h("b", { text: "ball in hand" }), " and can put the white anywhere."), h("p", {}, "Not sure? Tap ", h("b", { text: "What happened?" }), " and the app tells you.")]],
  ["The 8 wins (or loses)", () => [h("p", {}, "Once all your balls are down, say which pocket, then pot the 8 to ", h("b", { text: "win" }), "."), h("p", {}, "Pot it early, in the wrong pocket, or with a foul, and you ", h("b", { text: "lose" }), ".")]],
  ["Games and matches", () => [h("p", {}, "Play as many games as you like, or a best-of match: the app counts games won, and you take turns to break. People call this game pool, 8-ball or billiards."), h("p", {}, "The app tells you what to do at every step. You just tap what happened.")]],
];

/* ---------------- the interface screens/game.js uses ---------------- */

export default {
  id: "pool",
  label: "8-ball pool",
  rules,
  lessons: LESSONS,
  lessonsTitle: "How 8-ball pool works",
  helpAnswer: "p-how",
  ask: {
    placeholder: "e.g. what if I scratch on the 8?",
    noMatch: "No match. Try words like scratch, foul, break, 8, open table, call or ball in hand.",
    picture: (show) => (["rack", "kitchen", "anywhere", "spot"].includes(show) ? poolSVG({ [show]: true }) : null),
  },
  headerDetail: () => "8-ball",
  tour: {
    players: "How many balls each side has left. Before anyone has a group, it's an open table.",
    pad: "When a ball goes in, tap it. The app works out solids and stripes, fouls and ball in hand.",
  },
  playerCard,
  scoreClass: "pool-score",
  standing: standingLine,
  guide,
  pad,
  padClass: "pool-pad",
  buttons: (s) => ({ miss: s.breakShot ? ["Log the break", "after the balls stop"] : ["Missed", "no foul, nothing in"], what: ["What happened?", "fouls, odd shots"] }),
  onMiss,
  onWhat,
  undoLabel,
  logRows,
  gate,
  result,
  announce,
  setupPicture: () => [h("div", { class: "table-wrap", html: poolSVG({ rack: true }) }), rackSteps()],
  setupTitle: "How to rack the balls",
  pdot,
};
