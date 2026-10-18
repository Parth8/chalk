// The game screen both games share: header, the two sides, what to do now, the ball pad, the
// three buttons, and the list of what happened. Everything particular to snooker or pool comes
// from the game's own screens module (js/snooker/ui.js, js/pool/ui.js) through one interface.

import { $, h, btn, markNew, toast } from "../core/dom.js";
import { sheet, closeSheet, isOpen, onSheetClose } from "../core/sheet.js";
import { session, act, can, state, names, eventsNow, frameNo, isShared, restartLocal } from "../core/session.js";
import { gamesWon, matchWinner, gamesNeeded, playerUp, playerNext, targetWords, sideName } from "../core/match.js";
import { tap, say } from "../core/sound.js";
import { startTour, touring } from "../core/coach.js";
import { shareCard } from "../core/share-card.js";
import * as sync from "../core/sync.js";
import * as store from "../core/store.js";
import { gameUI } from "../games.js";
import { answerSheet } from "./ask.js";
import { showing } from "./views.js";

export function renderGame() {
  if (!session.match || !session.match.frames.length) return;
  const ui = gameUI();
  const s = state();
  $("#view-game").classList.toggle("game-over", s.over);
  noticeDeclined();
  renderHeader(ui);
  renderPlayers(ui, s);
  $("#standing").replaceChildren(...[].concat(ui.standing(s), matchLine(s)));
  renderGuide(ui, s);
  renderPad(ui, s);
  renderActions(ui, s);
  const rows = ui.logRows(s).filter(Boolean);
  $("#log").replaceChildren(...(rows.length ? rows : [h("li", { class: "info empty", text: "Nothing potted yet. Tap a ball when it drops." })]));
  if (!gates(ui, s)) maybeTour(ui, s);
  speak(ui, s);
}

/* ---------------- header and the two sides ---------------- */

function renderHeader(ui) {
  const m = session.match;
  const tag = $("#frame-tag");
  tag.replaceChildren(h("button", { type: "button", class: "frame-help", on: { click: () => answerSheet(ui.helpAnswer) } }, "Game ", h("b", { text: String(frameNo()) })), ` · ${ui.headerDetail(m)}`);
  if (m.target) tag.append(` · ${targetWords(m.target)}`);
  if (isShared()) tag.append(" · ", h("span", { class: `live${sync.online.down ? " down" : ""}`, text: sync.status() }));
}

function renderPlayers(ui, s) {
  const m = session.match;
  const n = names();
  const won = gamesWon(m);
  const at = (p) => !s.over && !s.toss && s.turn === p;
  const card = (p) => {
    const body = ui.playerCard(s, p);
    const team = m.teams?.[p]?.length > 1;
    return h(
      "div",
      { class: `player${at(p) ? " at" : ""}${s.over && s.winner === p ? " won" : ""}`, "aria-label": `${n[p]}: ${body.label}` },
      h("div", { class: "p-name" }, h("span", { text: n[p] }), isShared() && session.seat === p ? h("span", { class: "p-you", text: "YOU" }) : null),
      team ? h("div", { class: "p-up", text: at(p) ? `${playerUp(m, p)} to play` : `next: ${playerNext(m, p)}` }) : null,
      h("div", { class: `p-score ${ui.scoreClass}`, text: body.big }),
      h("div", { class: "p-sub" }, ...body.sub),
      body.extra || null
    );
  };
  $("#players").replaceChildren(card(0), h("div", { class: "frames" }, h("b", { text: `${won[0]}–${won[1]}` }), h("small", { text: m.target ? `FIRST TO ${m.target}` : "GAMES WON" })), card(1));
}

/** "Asha needs 1 more game" in a best-of match. */
function matchLine(s) {
  const need = gamesNeeded(session.match);
  if (!need || matchWinner(session.match) !== null || s.over) return [];
  const n = names();
  const words = (p) => `${n[p]} needs ${need[p]} more`;
  return [" · ", need[0] === need[1] ? `first to ${session.match.target} games` : need[0] < need[1] ? words(0) : words(1)];
}

/* ---------------- what to do now ---------------- */

function renderGuide(ui, s) {
  const { cards, alerts } = ui.guide(s);
  if (s.over) cards.unshift(overCard(ui, s));
  const ask = restartAsk();
  if (ask) alerts.unshift(ask);
  $("#guide").replaceChildren(...cards);
  $("#alerts").replaceChildren(...alerts);
  markNew();
}

/** The end of a game, or of the whole match: who won, then the next game or a picture to share. */
function overCard(ui, s) {
  const m = session.match;
  const n = names();
  const r = ui.result(s);
  const champ = matchWinner(m);
  const won = gamesWon(m);
  const share = (card) => btn("Share the result", () => shareCard(card), "btn");
  if (champ !== null) {
    const score = `${won[champ]}–${won[1 - champ]}`;
    return h(
      "div",
      { class: "g-card match-over", "data-key": `match-${frameNo()}` },
      h("p", { class: "g-kicker", text: `Match over · ${targetWords(m.target)}` }),
      h("p", { class: "g-title", text: `${n[champ]} wins the match, ${score}` }),
      h("p", { class: "g-text", text: `Last game: ${n[s.winner]} won${r.score ? ` ${r.score}` : ""}. ${r.line}` }),
      h(
        "div",
        { class: "row" },
        share({ game: ui.label, title: `${n[champ]} wins the match`, score, lines: [`${n[0]} v ${n[1]} · ${targetWords(m.target)}`] }),
        newMatchButton()
      )
    );
  }
  const next = 1 - m.frames[frameNo() - 1].breaker;
  return h(
    "div",
    { class: "g-card", "data-key": `over-${frameNo()}` },
    h("p", { class: "g-kicker", text: `Game ${frameNo()} over` }),
    h("p", { class: "g-title", text: `${n[s.winner]} wins${r.score ? `, ${r.score}` : ""}` }),
    h("p", { class: "g-text", text: `${r.line}${r.note ? ` (${r.note})` : ""}` }),
    h(
      "div",
      { class: "row" },
      can("next", s) ? btn(`Play game ${frameNo() + 1} · ${playerUp(m, next, frameNo())} breaks`, () => act({ t: "next" }), "btn primary") : null,
      share({ game: ui.label, title: `${n[s.winner]} wins game ${frameNo()}`, score: r.score, lines: [r.line, `Games won: ${n[0]} ${won[0]}, ${n[1]} ${won[1]}`] })
    )
  );
}

function newMatchButton() {
  if (!isShared()) return btn("Play another match", () => restartLocal(true), "btn primary");
  if (session.seat === null) return null;
  return btn("Play another match (asks the other side)", () => act({ t: "restart", all: true }), "btn primary");
}

/** When the other side says no to this phone's restart request, say so (the card just goes away). */
let asked = null;
let cancelledByMe = false;
function noticeDeclined() {
  const m = session.match;
  const ask = isShared() ? m.frames[frameNo() - 1].ask : null;
  const mine = ask && ask.by === session.seat ? { id: session.id, games: m.frames.length, restarts: m.frames[frameNo() - 1].restarts || 0 } : null;
  if (asked && !ask && !cancelledByMe && asked.id === session.id && asked.games === m.frames.length && asked.restarts === (m.frames[frameNo() - 1].restarts || 0)) {
    toast(`${names()[1 - session.seat]} said no, so the game carries on.`);
  }
  if (!ask) cancelledByMe = false;
  asked = mine;
}

/** In a shared game, one side asked to restart: the other side agrees or says no. */
function restartAsk() {
  if (!isShared()) return null;
  const ask = session.match.frames[frameNo() - 1].ask;
  if (!ask) return null;
  const n = names();
  const what = ask.all ? "start the whole match over (every game back to 0)" : "restart this game (scores back to 0)";
  const mine = ask.by === session.seat;
  return h(
    "div",
    { class: "g-card foul", "data-key": `ask-${ask.by}-${ask.all}` },
    h("p", { class: "g-kicker", text: "Restart?" }),
    h("p", { class: "g-title", text: mine ? `Waiting for ${n[1 - ask.by]} to agree` : `${n[ask.by]} wants to ${what}` }),
    mine
      ? h("div", { class: "row" }, btn("Cancel", () => ((cancelledByMe = true), act({ t: "restart-no" }))))
      : session.seat !== null
        ? h("div", { class: "row" }, btn("Agree", () => act({ t: "restart", all: ask.all }), "btn warn"), btn("No, keep playing", () => act({ t: "restart-no" })))
        : null
  );
}

/* ---------------- the pad and the three buttons ---------------- */

function renderPad(ui, s) {
  const pad = $("#pad");
  pad.className = `pad${ui.padClass === "pad" ? "" : ` ${ui.padClass}`}`;
  pad.classList.toggle("locked", !can("turn", s));
  pad.replaceChildren(...ui.pad(s));
}

function renderActions(ui, s) {
  const turn = can("turn", s);
  const { miss, what } = ui.buttons(s);
  $("#btn-miss").replaceChildren(h("b", { text: miss[0] }), h("small", { text: miss[1] }));
  $("#btn-foul").replaceChildren(h("b", { text: what[0] }), h("small", { text: what[1] }));
  $("#btn-miss").disabled = !turn;
  $("#btn-foul").disabled = !turn;
  $("#btn-undo").disabled = !can("undo", s);
  const last = eventsNow()[eventsNow().length - 1];
  $("#undo-sub").textContent = last ? ui.undoLabel(last) : session.match.frames.length > 1 ? "new game" : "last tap";
}

/* ---------------- steps at the table, the walkthrough, spoken prompts ---------------- */

let gateKey = "";

/**
 * Setting up the table and putting balls back: pop-ups that only close once done. They show on a
 * phone that can play: on this phone always; in a shared game, setting up on both sides' phones
 * and putting a ball back on the phone of the side at the table.
 */
function gates(ui, s) {
  const g = ui.gate(s);
  const allowed = g && (!isShared() || (session.ready && (g.everyone ? session.seat !== null : can("turn", s))));
  if (allowed) {
    if (sheet.kind !== g.kind || gateKey !== g.key) {
      gateKey = g.key;
      g.open();
    }
    return true;
  }
  if (sheet.kind === "setup" || sheet.kind === "spot") closeSheet(); // e.g. undone on the other phone
  return false;
}

/** The first game of each kind on this phone: point out the parts of the screen, once. */
function maybeTour(ui, s) {
  const toured = store.read(store.KEYS.toured, {});
  const playing = isShared() ? session.ready && session.seat !== null : true; // not for someone just watching
  if (toured[ui.id] || touring() || isOpen() || eventsNow().length || frameNo() > 1 || s.over || !playing) return;
  store.write(store.KEYS.toured, { ...toured, [ui.id]: true });
  startTour(tourSteps(ui));
}

export function tourSteps(ui = gameUI()) {
  return [
    { target: "#players", title: "The score", text: ui.tour.players },
    { target: "#guide", title: "What to do now", text: "This card tells the player at the table what's on. It changes after every shot." },
    { target: "#pad", title: "Tap what went in", text: ui.tour.pad },
    { target: "#btn-miss", title: "Nothing went in?", text: "Tap Missed. The turn passes to the other side." },
    { target: "#btn-foul", title: "Not sure if it was a foul?", text: "Tap What happened?, answer a couple of questions, and the app gives the ruling." },
    { target: "#btn-undo", title: "Tapped the wrong thing?", text: "Undo takes back the last tap. Nothing is final." },
    { target: "#view-game .ask-btn", title: "Got a question?", text: 'Ask things like "what if I pot the white?" and get an answer for this exact moment.' },
    { target: "#view-game [data-open=menu]", title: "Everything else", text: "Restart, give up a game, a coin toss, sounds and spoken prompts, how to set up, and more." },
  ];
}

/** Say what's next when it changes, if spoken prompts are on (and not over the walkthrough). */
function speak(ui, s) {
  if (touring() || !showing("game")) return;
  if (s.over) {
    const champ = matchWinner(session.match);
    return say(champ !== null ? `${sideName(session.match, champ)} wins the match!` : `${names()[s.winner]} wins game ${frameNo()}.`);
  }
  say(ui.announce(s));
}

/* ---------------- wiring ---------------- */

export function initGame() {
  $("#btn-miss").addEventListener("click", () => can("turn") && gameUI().onMiss());
  $("#btn-foul").addEventListener("click", () => can("turn") && gameUI().onWhat());
  $("#btn-undo").addEventListener("click", () => act({ t: "undo" }));
  // a little click (and buzz) for every button pressed during a game
  $("#view-game").addEventListener("click", (e) => e.target.closest("button:not(:disabled)") && tap());
  $("#sheet").addEventListener("click", (e) => showing("game") && e.target.closest("button:not(:disabled)") && tap());
  // a pop-up closed (say a lesson opened from the set-up step): check what the table still needs
  onSheetClose(() => showing("game") && queueMicrotask(renderGame));
}
