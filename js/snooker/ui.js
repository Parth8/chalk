// Snooker's screens: the ball pad (tap a colour to call it, again when it goes in), what's on,
// fouls and the choices after them, "What happened?", setting up the table and putting colours
// back. The shared game screen (screens/game.js) calls these through the interface at the bottom.

import { BALLS, COLOURS, VALUE, ballsOn, firstOn, judgePot, judgeShot, OTHER_FOULS, standing } from "./engine.js";
import * as rules from "./rules.js";
import { tableSVG, setupSVG, spotOrder, SPOT_WORDS } from "./table.js";
import { h, btn, cap, cardWithPicture } from "../core/dom.js";
import { openSheet, closeSheet } from "../core/sheet.js";
import { session, act, can, changed, state, names, eventsNow, evKey, frameNo, gameKey, isShared } from "../core/session.js";
import { lessonSheet } from "../core/lessons.js";
import { playerUp } from "../core/match.js";
import { tossSheet } from "../core/toss.js";

const dot = (ball, cls = "dot") => h("span", { class: cls, "data-ball": ball, "aria-hidden": "true" });
const up = (s) => playerUp(session.match, s.turn); // who's at the table (a player's name in doubles)

/** Pop-up progress that belongs to this phone only. */
const local = { setupDone: new Set(), spot: { key: "", step: 0, fall: 0 }, spotDone: "", foulDone: "" };

/* ---------------- the players' cards and the line under them ---------------- */

function playerCard(s, p) {
  const sub = s.turn === p && s.brk > 0 && !s.over ? ["Break ", h("b", { text: String(s.brk) })] : s.best[p] ? [`Best break ${s.best[p]}`] : [];
  return { big: String(s.scores[p]), sub, label: `${s.scores[p]} points` };
}

function standingLine(s) {
  if (s.over) return [];
  const st = standing(s);
  const n = names();
  const out = [st.leader === null ? "Level" : `${n[st.leader]} leads by ${st.lead}`, ` · ${st.left} left on the table`];
  if (st.snookers) out.push(" · ", h("span", { class: "snk", text: `${n[1 - st.leader]} needs snookers` }));
  return out;
}

/* ---------------- what's on, fouls, the re-spotted black ---------------- */

function onColour(s) {
  if (s.phase === "red") return "red";
  if (s.phase === "clear") return COLOURS[s.next];
  return null;
}

function guide(s) {
  const n = names();
  const cards = [];
  const alerts = [];
  const me = up(s);

  if (s.toss) {
    const choose = (winner) => [
      h("p", { class: "lead-text", text: `${n[winner]} chooses who plays the black:` }),
      h(
        "div",
        { class: "row" },
        [0, 1].map((p) =>
          btn(`${n[p]} plays`, () => {
            closeSheet();
            act({ t: "toss", who: p });
          }, "btn primary")
        )
      ),
    ];
    const card = h(
      "div",
      { class: "g-card", style: "--on: var(--black)", "data-key": `toss-${evKey()}` },
      h("p", { class: "g-kicker", text: `Level at ${s.scores[0]}` }),
      h("p", { class: "g-title", text: "Re-spotted black" }),
      h("p", { class: "g-text", text: "Black back on its spot. Toss a coin: the winner picks who plays, with the white in hand in the D. Next score or foul wins." }),
      can("toss", s)
        ? h(
            "div",
            { class: "row" },
            btn("Toss a coin", () => tossSheet({ title: "Who plays the black?", intro: "The winner of the toss chooses who plays first.", names: n, after: choose }), "btn primary"),
            btn(`${n[0]} plays`, () => act({ t: "toss", who: 0 })),
            btn(`${n[1]} plays`, () => act({ t: "toss", who: 1 }))
          )
        : null
    );
    cards.push(cardWithPicture(card, tableSVG({ spot: "black", d: true, labels: false })));
  }

  if (s.foul && local.foulDone !== evKey()) alerts.push(foulCard(s, n));

  const spot = isShared() && !can("turn", s) ? spotCard(s) : null; // the phone at the table gets the pop-up
  if (spot) alerts.push(spot);

  if (!s.over && !s.toss) cards.push(onCard(s, me));
  return { cards, alerts };
}

function foulCard(s, n) {
  const off = n[s.foul.by];
  const inc = n[s.turn];
  const showD = () => openSheet("White in hand", h("p", { class: "lead-text", text: "Anywhere inside the D, or on its lines. Pick it up and move it as often as you like until you play. Any direction is fine." }), h("div", { class: "table-wrap", html: tableSVG({ d: true }) }));
  return h(
    "div",
    { class: "g-card foul", "data-key": `foul-${evKey()}` },
    h("p", { class: "g-kicker", text: `Foul by ${off}` }),
    h("p", { class: "g-title", text: `${s.foul.pen} points to ${inc}` }),
    h("p", { class: "g-text" }, cap(s.foul.why), ". ", s.inHand ? [h("b", { text: "White in hand: anywhere in the D." }), " ", btn("Show me", showD, "link")] : "Play from where the white stopped. It's not ball in hand."),
    can("turn", s)
      ? h(
          "div",
          { class: "row" },
          btn("I'll play", () => {
            local.foulDone = evKey();
            changed();
          }, "btn primary"),
          btn(`${off} plays again`, () => act({ t: "again" })),
          btn("Free ball (I'm snookered)", freeBallSheet),
          btn("Put balls back (miss)", () => missSheet(off))
        )
      : h("p", { class: "g-text", text: `${inc} decides: play on, make ${off} play again, or take a free ball if snookered.` })
  );
}

function onCard(s, me) {
  let on = onColour(s);
  let kicker = `${me} · at the table`;
  let title;
  let text;
  let extra = null;
  if (s.respot) {
    title = "Re-spotted black";
    text = "Next score or foul wins the game.";
  } else if (s.free) {
    title = "Free ball";
    text = `Pick any colour and play it as the ${s.phase === "red" ? "red" : COLOURS[s.next]}. Potted, it scores ${s.phase === "red" ? 1 : VALUE[COLOURS[s.next]]} and goes back on its spot.`;
  } else if (s.phase === "red") {
    const breakOff = eventsNow().length === 0;
    if (breakOff) kicker = `${me} · break-off`;
    title = "Pot any red";
    text = breakOff ? "White anywhere in the D. Hit a red first." : `${s.reds} red${s.reds === 1 ? "" : "s"} left. After a red, you call a colour.`;
  } else if (s.phase === "colour" && !s.called) {
    title = "Call a colour";
    text = `Tap the colour you're going for.${s.reds > 0 ? "" : " (That was the last red: after this colour it's yellow to black in order.)"}`;
  } else if (s.phase === "colour") {
    on = s.called;
    title = `Going for the ${s.called} (${VALUE[s.called]})`;
    text = `Tap the ${s.called} again when it goes in. Changed your mind? Tap another colour.`;
  } else {
    title = `${cap(on)} (${VALUE[on]})`;
    text = "Colours in order now. They stay down.";
    extra = h("div", { class: "seq", "aria-hidden": "true" }, COLOURS.map((c, i) => dot(c, `dot${i < s.next ? " done" : i === s.next ? " now" : ""}`)));
  }
  const card = h("div", { class: "g-card", style: `--on: var(--${on || "accent"})` }, h("p", { class: "g-kicker", text: kicker }), h("p", { class: "g-title", text: title }), h("p", { class: "g-text", text }), extra);
  if (isShared() && !can("turn", s)) card.append(h("p", { class: "g-text", text: session.seat === null ? `${me}'s phone logs this visit.` : `${me} logs this visit on their phone. You'll see it here live.` }));
  if (!s.inHand) return card;
  // white in hand: show the D right there, next to what's on
  if (eventsNow().length) card.append(h("p", { class: "g-text" }, h("b", { text: "White in hand: " }), "anywhere inside the D or on its lines, then play in any direction."));
  card.classList.add("in-hand");
  return cardWithPicture(card, tableSVG({ d: true, labels: false }));
}

/** On the other phone in a shared game: a note that a colour is going back, and where. */
function spotCard(s) {
  if (!s.toSpot.length || s.toss) return null;
  const ball = s.toSpot[0];
  const card = h(
    "div",
    { class: "g-card", style: `--on: var(--${ball})`, "data-key": `spot-${evKey()}` },
    h("p", { class: "g-kicker", text: s.toSpot.length > 1 ? `Then: ${s.toSpot.slice(1).join(", ")}` : "Re-spot" }),
    h("p", { class: "g-title", text: `Put the ${ball} back` }),
    h("p", { class: "g-text", text: `On its own spot: ${SPOT_WORDS[ball]}.` })
  );
  return cardWithPicture(card, tableSVG({ spot: ball, labels: false }));
}

/* ---------------- the pad ---------------- */

/**
 * A tap on a ball:
 *   on a red             red = potted
 *   on a colour          first tap calls it, a second tap on the same colour = potted
 *   in the clearance     the ball on = potted
 * Anything else opens "What happened?", which works out whether it was a foul.
 */
function onBall(ball) {
  const s = state();
  if (!can("turn", s)) return;
  if (s.phase === "colour" && ball !== "red" && s.called !== ball) return act({ t: "call", ball });
  const j = judgePot(s, ball);
  if (j.ok && j.extra) return act({ t: "pot", ball, extra: true }); // the button says "another red in, same shot"
  if (j.ok) return act({ t: "pot", ball });
  if (j.reason !== "foul") return;
  const intro =
    s.phase === "red"
      ? `You're on a red, so the white has to hit a red first, and only reds may go in. What happened with the ${ball}?`
      : s.phase === "colour"
        ? `You called the ${s.called}. What happened with the red?`
        : `You're on the ${COLOURS[s.next]}. What happened with the ${ball}?`;
  shotSheet(ball === "red" ? { reds: 1 } : { first: ball }, intro);
}

function pad(s) {
  const on = ballsOn(s);
  const turn = can("turn", s);
  const callable = s.phase === "colour" && !s.free;
  const balls = BALLS.map((b) => {
    const called = callable && s.called === b;
    const isOn = callable ? b !== "red" && (!s.called || called) : on.includes(b);
    const free = s.free && on.includes(b) && b !== "red" && !(s.phase === "clear" && b === COLOURS[s.next]);
    const extraRed = b === "red" && s.phase === "colour" && s.lastRed && s.reds > 0;
    const label = b === "red" ? `Red, ${s.reds} left` : `${cap(b)}, ${VALUE[b]}`;
    const tag = free ? "FREE" : called ? "CALLED" : callable && b !== "red" && !s.called ? "CALL" : null;
    return h(
      "button",
      {
        type: "button",
        class: `ball ${b === "red" ? "red" : ""} ${isOn ? "on" : extraRed ? "extra" : "off"}${called ? " called" : ""}${callable && b !== "red" && !s.called ? " callable" : ""}`,
        "data-ball": b,
        "aria-label": extraRed ? `Another red went in on the same shot (${s.reds} left)` : callable && b !== "red" ? (called ? `${label}: potted` : `Call the ${b}`) : `${label}${isOn ? "" : " (not on)"}`,
        disabled: !turn || (b === "red" && s.reds === 0),
        on: { click: () => onBall(b) },
      },
      b === "red" ? (s.reds ? (extraRed ? ["Another red in, same shot", h("span", { class: "count", text: "+1" })] : ["Red", h("span", { class: "count", text: `× ${s.reds}` })]) : "No reds left") : String(VALUE[b]),
      tag ? h("span", { class: "tag", text: tag }) : null
    );
  });
  return turn ? [...balls, h("p", { class: "pad-hint", text: padHint(s) })] : balls;
}

/** One plain line under the balls: what to tap now. */
function padHint(s) {
  if (s.free) return "Free ball: tap the colour you potted as the free ball, or a red if a red went in.";
  if (s.phase === "red") return "A red went in? Tap Red. Nothing went in? Tap Missed.";
  if (s.phase === "colour" && !s.called) return "Tap a colour to call it.";
  if (s.phase === "colour") return `Called the ${s.called}: tap it again when it goes in, or tap Missed.`;
  return `Tap the ${COLOURS[s.next]} when it goes in, or tap Missed.`;
}

/* ---------------- sheets: free ball, foul and a miss, What happened? ---------------- */

function freeBallSheet() {
  const s = state();
  const val = s.phase === "red" ? 1 : VALUE[COLOURS[s.next]];
  openSheet(
    "Free ball?",
    h("p", { class: "lead-text" }, "Only if the foul left you ", h("b", { text: "snookered" }), `: a ball that's not on blocks the white from hitting both sides of every ${s.phase === "red" ? "red" : `ball on (the ${COLOURS[s.next]})`}.`),
    h("p", { class: "lead-text", text: `Then pick any colour as your ball on. Potted, it scores ${val} and goes back on its spot. You can't hide the white behind it.` }),
    btn("Take the free ball", () => {
      closeSheet();
      act({ t: "free" });
    }, "btn primary big")
  );
}

function missSheet(off) {
  openSheet(
    "Foul and a miss",
    h("p", { class: "lead-text", text: `Use this when ${off} didn't make a proper attempt to hit the ball on. The balls go back where they were and ${off} plays the shot again. The penalty points stay.` }),
    h("p", { class: "lead-text", text: "Friendly games often skip this rule. Three misses in a row with a clear view of the ball on loses the game." }),
    btn("Put the balls back", () => {
      closeSheet();
      act({ t: "replace" });
    }, "btn primary big")
  );
}

/**
 * "What happened?": describe the shot in plain words and the app rules on it
 * (potted, missed, or a foul with the reason and the points), so nobody needs the rulebook.
 */
function shotSheet(prefill = {}, intro = "") {
  const s = state();
  const n = names();
  const me = up(s);
  const opp = n[1 - s.turn];
  const onFirst = firstOn(s);
  const shot = {
    first: prefill.first || (onFirst.length === 1 ? onFirst[0] : s.phase === "red" ? "red" : null),
    reds: prefill.reds || 0,
    colours: new Set(prefill.colours || []),
    white: false,
    other: null,
    called: null,
  };
  const body = h("div", { class: "shot" });
  const chip = (label, pressed, onClick, { ball, sub } = {}) =>
    h("button", { type: "button", class: `chip${ball ? " ball-chip" : ""}`, "aria-pressed": String(pressed), on: { click: onClick } }, ball ? dot(ball) : null, label, sub ? h("small", { text: sub }) : null);
  const set = (fn) => () => {
    fn();
    draw();
  };

  const draw = () => {
    const parts = [];
    const onText = s.phase === "red" ? "a red" : s.phase === "colour" ? (s.called ? `the ${s.called} (called)` : "a colour (none called yet)") : `the ${COLOURS[s.next]}`;
    parts.push(h("p", { class: "lead-text" }, intro || "Tell me what happened and I'll work out the rest. ", intro ? null : ["You were on ", h("b", { text: onText }), "."]));

    // 1. first contact
    const order = [...onFirst, ...BALLS.filter((b) => !onFirst.includes(b))].filter((b) => b !== "red" || s.reds > 0);
    parts.push(
      h("h3", { text: "1. What did the white hit first?" }),
      h("div", { class: "chips" }, order.map((b) => chip(cap(b), shot.first === b, set(() => (shot.first = b)), { ball: b, sub: onFirst.includes(b) ? "on" : null })), chip("Nothing", shot.first === "nothing", set(() => (shot.first = "nothing"))))
    );

    // 2. what went in
    const none = !shot.white && !shot.reds && !shot.colours.size;
    parts.push(
      h("h3", { text: "2. What went in? (or flew off the table)" }),
      h(
        "div",
        { class: "chips" },
        chip("Nothing", none, set(() => Object.assign(shot, { white: false, reds: 0, colours: new Set() }))),
        chip("White", shot.white, set(() => (shot.white = !shot.white)), { ball: "white" }),
        s.reds
          ? h(
              "span",
              { class: "chip ball-chip", "aria-pressed": String(shot.reds > 0) },
              dot("red"),
              `Red × ${shot.reds}`,
              h("span", { class: "stepper" }, btn("−", set(() => (shot.reds = Math.max(0, shot.reds - 1))), "", { "aria-label": "One red fewer" }), btn("+", set(() => (shot.reds = Math.min(s.reds, shot.reds + 1))), "", { "aria-label": "One more red" }))
            )
          : null,
        COLOURS.map((c) => chip(cap(c), shot.colours.has(c), set(() => (shot.colours.has(c) ? shot.colours.delete(c) : shot.colours.add(c))), { ball: c }))
      )
    );

    // a colour hadn't been called yet and the white didn't hit one: which were they going for?
    if (s.phase === "colour" && !s.called && shot.first && !COLOURS.includes(shot.first)) {
      parts.push(
        h("h3", { text: "Which colour were you going for?" }),
        h("div", { class: "chips" }, COLOURS.map((c) => chip(cap(c), shot.called === c, set(() => (shot.called = shot.called === c ? null : c)), { ball: c })), chip("Hadn't said", !shot.called, set(() => (shot.called = null))))
      );
    }

    // 3. anything else
    const more = h(
      "details",
      { class: "more" },
      h("summary", { text: shot.other ? `3. Also: ${OTHER_FOULS[shot.other].toLowerCase()}` : "3. Anything else? (touched a ball, push, jump…)" }),
      h(
        "div",
        { class: "choices" },
        Object.entries(OTHER_FOULS)
          .filter(([k]) => k !== "outside-d" || s.inHand)
          .map(([k, label]) => h("button", { type: "button", class: "choice", "aria-pressed": String(shot.other === k), on: { click: set(() => (shot.other = shot.other === k ? null : k)) } }, label))
      )
    );
    more.open = !!shot.other;
    parts.push(more);
    parts.push(shot.first ? verdict(s, shot, me, opp) : h("div", { class: "verdict" }, h("p", { text: "Pick what the white hit first." })));
    body.replaceChildren(...parts);
  };
  draw();
  openSheet("What happened?", body);
}

function verdict(s, shot, me, opp) {
  const r = judgeShot(s, { first: shot.first, reds: shot.reds, colours: [...shot.colours], white: shot.white, other: shot.other, called: shot.called });
  const go = (label, cls) =>
    btn(label, () => {
      closeSheet();
      for (const e of r.events) act(e);
    }, `btn big ${cls}`);
  if (r.result === "pot") return h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `Fair pot: +${r.pts} to ${me}` }), go(`Add ${r.pts} to ${me}`, "primary"));
  if (r.result === "miss") return h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: "Not a foul" }), h("p", { text: `${r.reasons[0]} ${opp}'s turn.` }), go(`Missed: ${opp}'s turn`, ""));
  const after = [shot.white ? `${opp} puts the white anywhere in the D` : `${opp} plays from where the white stopped (not ball in hand)`];
  if (shot.reds) after.push(`${shot.reds === 1 ? "the red stays" : "the reds stay"} down`);
  if (shot.colours.size) after.push(`the ${[...shot.colours].join(" and ")} go${shot.colours.size === 1 ? "es" : ""} back on ${shot.colours.size === 1 ? "its spot" : "their spots"}`);
  return h(
    "div",
    { class: "verdict foul" },
    h("p", { class: "v-title", text: `Foul: ${r.pen} points to ${opp}` }),
    h("ul", { class: "reasons" }, r.reasons.map((x) => h("li", { text: x }))),
    h("p", { text: `Worth ${r.pen} because ${r.why}. Then ${after.join(", ")}.` }),
    go(`Give ${r.pen} to ${opp}`, "warn")
  );
}

/* ---------------- pop-ups that must be done at the table ---------------- */

/** Setting up the table before a game, then putting potted colours back: { kind, key, open } or null. */
function gate(s) {
  const key = gameKey();
  if (!eventsNow().length && !s.over && !local.setupDone.has(key)) return { kind: "setup", key, everyone: true, open: () => setupSheet(key) };
  if (s.toSpot.length && !s.toss && local.spotDone !== evKey()) return { kind: "spot", key: `spot-${evKey()}`, everyone: false, open: () => spotSheet(state()) };
  return null;
}

function setupSteps(reds, breaker) {
  const d = (b) => dot(b);
  return h(
    "ol",
    { class: "steps" },
    h("li", {}, h("span", {}, "Stand at the end with the ", h("b", { text: "D" }), " (the half circle). You break from here.")),
    h("li", {}, h("span", {}, "On the line: ", d("green"), h("b", { text: "green" }), " on the left corner of the D, ", d("brown"), h("b", { text: "brown" }), " in the middle, ", d("yellow"), h("b", { text: "yellow" }), " on the right corner.")),
    h("li", {}, h("span", {}, d("blue"), h("b", { text: "Blue" }), " on the spot in the very middle of the table.")),
    h("li", {}, h("span", {}, d("pink"), h("b", { text: "Pink" }), " on the spot halfway between the blue and the far cushion.")),
    h("li", {}, h("span", {}, d("red"), h("b", { text: `${reds} reds` }), " packed in a triangle just behind the pink, point towards it but not touching. A triangle frame makes this easy.")),
    h("li", {}, h("span", {}, d("black"), h("b", { text: "Black" }), " on the spot near the far cushion.")),
    h("li", {}, h("span", {}, d("white"), h("b", { text: "White" }), breaker ? ` anywhere inside the D. ${breaker} plays it at the reds.` : " anywhere inside the D."))
  );
}

function setupSheet(key) {
  const breaker = playerUp(session.match, session.match.frames[frameNo() - 1].breaker);
  openSheet(
    `Game ${frameNo()}: set up the table`,
    { locked: true, kind: "setup" },
    h("p", { class: "lead-text" }, "Put the balls out exactly like this. ", h("b", { text: `${breaker} breaks first.` })),
    h("div", { class: "table-wrap", html: setupSVG(session.match.reds) }),
    setupSteps(session.match.reds, breaker),
    btn("The table is ready", () => {
      local.setupDone.add(key);
      closeSheet();
      changed();
    }, "btn primary big"),
    btn("New to snooker? How it works", () => lessonSheet(LESSONS, "How snooker works"), "link")
  );
}

/** "Put the pink back": a pop-up that stays until the ball is back on the table. */
function spotSheet(s) {
  const key = evKey();
  if (local.spot.key !== key) local.spot = { key, step: 0, fall: 0 };
  const ball = s.toSpot[local.spot.step];
  const order = spotOrder(ball);
  const all = local.spot.fall >= order.length;
  const at = all ? ball : order[local.spot.fall];
  const later = s.toSpot.slice(local.spot.step + 1);
  const why = s.foul ? "Colours that go in on a foul always come back." : s.reds > 0 || s.phase === "clear" ? "While there are reds left, colours come back on the table after they're potted." : "The colour after the last red comes back too. From now on they stay down.";
  let where;
  if (all) where = `Every spot is covered: put it as close to its own spot as you can, towards the far cushion${ball === "pink" || ball === "black" ? " (if that's blocked, straight below its spot)" : ""}, not touching another ball.`;
  else if (at === ball) where = `On its own spot: ${SPOT_WORDS[ball]}.`;
  else where = `Its own spot is covered, so use the highest free spot: the ${at} spot (${SPOT_WORDS[at]}).`;
  const done = () => {
    local.spot.step++;
    local.spot.fall = 0;
    if (local.spot.step >= s.toSpot.length) {
      local.spotDone = key;
      closeSheet();
      changed();
    } else spotSheet(state());
  };
  openSheet(
    `Put the ${ball} back on the table`,
    { locked: true, kind: "spot" },
    h("p", { class: "lead-text", text: why }),
    h("div", { class: "spot-pop" }, h("div", { class: "table-wrap", html: tableSVG({ spot: all ? ball : at, ball, labels: true }) }), h("p", { class: "lead-text" }, h("b", { text: where }))),
    btn(later.length ? `Done. Next: the ${later[0]}` : all ? `The ${ball} is back on the table` : at === ball ? `The ${ball} is back on its spot` : `The ${ball} is on the ${at} spot`, done, "btn primary big"),
    all
      ? null
      : btn(local.spot.fall ? "That spot's covered too" : "Its spot is covered by another ball", () => {
          local.spot.fall++;
          spotSheet(state());
        }, "btn"),
    can("undo", s)
      ? btn(`Oops, the ${ball} didn't go in (undo)`, () => {
          closeSheet();
          act({ t: "undo" });
        }, "link")
      : null
  );
}

/* ---------------- the shared list of what happened ---------------- */

function logRows(s) {
  const n = names();
  const rows = [];
  let visit = null;
  const flush = () => visit && (rows.push(visit), (visit = null));
  for (const l of s.log) {
    if (l.t === "pot") {
      if (!visit || visit.p !== l.p) {
        flush();
        visit = { kind: "visit", p: l.p, balls: [], pts: 0 };
      }
      visit.balls.push(l);
      visit.pts += l.pts;
      continue;
    }
    flush();
    if (l.t !== "miss") rows.push(l); // after a miss, the next visit shows who came in
  }
  flush();
  return rows.reverse().map((r) => {
    if (r.kind === "visit")
      return h(
        "li",
        {},
        h("span", { class: "who", text: n[r.p] }),
        h("span", { class: "balls" }, r.balls.map((b) => (b.free ? h("span", {}, dot(b.ball), h("span", { class: "free", text: " FREE" })) : dot(b.ball)))),
        h("span", { class: "pts", text: `+${r.pts}` })
      );
    if (r.t === "foul") return h("li", { class: "foul" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls", text: `Foul${r.white ? " (in-off)" : ""} → ${n[r.to]}` }), h("span", { class: "pts", text: `+${r.pen}` }));
    const info = { again: `${n[r.p]} plays again`, replace: `Foul and a miss: balls put back, ${n[r.p]} plays again`, free: `${n[r.p]} takes a free ball`, respot: "Level: re-spotted black", concede: `${n[r.p]} gave up this game` }[r.t];
    return info ? h("li", { class: "info", text: info }) : null;
  });
}

const UNDO = { miss: "the miss", foul: "the foul", again: "play again", replace: "put back", free: "free ball", toss: "the toss", concede: "give up" };
const undoLabel = (e) => (e.t === "pot" ? `the ${e.ball}` : e.t === "call" ? `${e.ball} call` : UNDO[e.t] || "last tap");

/* ---------------- words for the end of a game, speech, and learning ---------------- */

function result(s) {
  const n = names();
  return {
    score: `${Math.max(...s.scores)}–${Math.min(...s.scores)}`,
    line: s.conceded !== null ? `${n[s.conceded]} gave up this game.` : `Highest breaks: ${n[0]} ${s.best[0]}, ${n[1]} ${s.best[1]}.`,
    note: `Snooker players call one game a "frame".`,
  };
}

/** What the phone says when the situation changes (if spoken prompts are on). */
function announce(s) {
  if (s.over || s.toss) return "";
  const who = up(s);
  if (s.foul) return `Foul. ${s.foul.pen} points to ${names()[s.turn]}.`;
  if (s.free) return `${who}, free ball.`;
  if (s.phase === "red") return `${who}, pot a red.`;
  if (s.phase === "colour") return s.called ? `${who}, going for the ${s.called}.` : `${who}, call a colour.`;
  return `${who}, the ${COLOURS[s.next]}.`;
}

const LESSONS = [
  ["The idea", () => [h("p", {}, "Take turns hitting the ", h("b", { text: "white ball" }), " with your cue to knock the coloured balls into the pockets (", h("b", { text: "potting" }), "). Each ball you pot scores points. More points when the table's cleared wins the game.")]],
  ["What each ball is worth", () => [h("div", { class: "balls-row" }, BALLS.map((b) => h("span", { class: "v" }, dot(b), String(VALUE[b])))), h("p", {}, "There are 15 reds (1 point each) and six colours. You only ever hit the white with the cue.")]],
  ["Your turn", () => [h("p", {}, "Your turn lasts as long as you keep potting. Miss, and it's the other player's turn. The points you score in one turn are your ", h("b", { text: "break" }), ".")]],
  [
    "The order",
    () => [
      h("p", {}, h("b", { text: "Red first, then a colour, then a red, then a colour…" })),
      h("p", {}, "Before your colour, say which one you're going for (", h("b", { text: "calling" }), " it). In the app: tap it once to call it, again when it goes in."),
      h("p", {}, "Reds stay in the pockets. Colours come back out onto their spots, and the app shows you where."),
    ],
  ],
  ["When the reds are gone", () => [h("p", {}, "Pot the colours in order: ", h("b", { text: "yellow, green, brown, blue, pink, black" }), ". Now they stay down. The black is the last ball and ends the game.")]],
  ["Fouls", () => [h("p", {}, "Hit the wrong ball first, miss everything, or put the white in a pocket? That's a ", h("b", { text: "foul" }), ": the other player gets 4 to 7 points."), h("p", {}, "Not sure? Tap ", h("b", { text: "What happened?" }), ", answer two questions, and the app tells you.")]],
  ["Games and matches", () => [h("p", {}, "Snooker players call one game a ", h("b", { text: "frame" }), ". Play as many as you like, or a best-of match: the app counts ", h("b", { text: "games won" }), " and you take turns to break."), h("p", {}, "The app tells you what to do at every step. You just tap what happened.")]],
];

/* ---------------- the interface screens/game.js uses ---------------- */

export default {
  id: "snooker",
  label: "Snooker",
  rules,
  lessons: LESSONS,
  lessonsTitle: "How snooker works",
  helpAnswer: "what-frame",
  ask: {
    placeholder: "e.g. what if I pot the white?",
    noMatch: "No match. Try words like white, foul, call, free ball, spot, order or miss.",
    picture: (show, m) => (show === "table" ? tableSVG({ rack: m ? m.reds : 15 }) : show === "d" ? tableSVG({ d: true }) : null),
  },
  headerDetail: (m) => `${m.reds} reds`,
  tour: {
    players: "Points for each side. The green outline shows who's at the table.",
    pad: "When a red goes in, tap Red. On a colour, tap it once to call it and again when it goes in.",
  },
  playerCard,
  scoreClass: "",
  standing: standingLine,
  guide,
  pad,
  padClass: "pad",
  buttons: () => ({ miss: ["Missed", "nothing went in"], what: ["What happened?", "fouls, odd shots"] }),
  onMiss: () => act({ t: "miss" }),
  onWhat: () => shotSheet(),
  undoLabel,
  logRows,
  gate,
  result,
  announce,
  setupPicture: (m) => [h("div", { class: "table-wrap", html: setupSVG(m.reds) }), setupSteps(m.reds)],
  setupTitle: "Where the balls go at the start",
};
