// Before a game: picking snooker or pool, the home screen (carry on, start a shared game or one
// on this phone, match length), and "who's playing?" for a game on this phone (singles or
// doubles, and who breaks, with an on-screen coin toss).

import { $, h, btn } from "../core/dom.js";
import { closeSheet, confirmSheet } from "../core/sheet.js";
import { loadLocal, deleteLocal } from "../core/session.js";
import { createMatch, replay, gamesWon, cleanTeam, targetWords } from "../core/match.js";
import { seats, forgetSeat } from "../core/api.js";
import { tossSheet } from "../core/toss.js";
import * as sync from "../core/sync.js";
import * as store from "../core/store.js";
import { GAMES, pickedGame, pickGame } from "../games.js";
import { show } from "./views.js";

/** Choices on the home and set-up screens (kept while the app is open). */
const pick = { reds: 15, target: 0, doubles: false, breaker: "0" };

let nav = null; // { openLocal(match), openShared(id, push) }

export function initHome(navigation) {
  nav = navigation;
  for (const art of document.querySelectorAll(".pool-art")) art.replaceChildren(...[1, 11, 8, 6, 13].map((n) => GAMES.pool.pdot(n, "pdot big")));
  // the home screen shows three pool balls, to fit next to snooker's three
  $("#game-pick .pool-art").replaceChildren(...[1, 11, 8].map((n) => GAMES.pool.pdot(n, "pdot big")));
  for (const b of document.querySelectorAll("#view-pick [data-game]"))
    b.addEventListener("click", () => {
      pickGame(b.dataset.game);
      showHome();
    });
  segment("#game-pick", "game", (v) => (pickGame(v), renderHome()));
  segment("#reds-pick", "reds", (v) => (pick.reds = +v));
  segment("#target-pick", "target", (v) => (pick.target = +v));
  segment("#side-pick", "sides", (v) => ((pick.doubles = v === "2"), renderSides()));
  segment("#break-pick", "b", (v) => ((pick.breaker = v), syncBreakPick()));
  $("#local-form").addEventListener("input", syncBreakPick);
  $("#local-form").addEventListener("submit", startLocal);
  $("#start-local").addEventListener("click", showLocalSetup);
  $("#start-online").addEventListener("click", startShared);
}

/** A row of radio buttons with data-<key> values. */
function segment(sel, key, onPick) {
  $(sel).addEventListener("click", (e) => {
    const b = e.target.closest(`[data-${key}]`);
    if (!b) return;
    for (const x of $(sel).children) x.setAttribute("aria-checked", String(x === b));
    onPick(b.dataset[key]);
  });
}

const checkSegment = (sel, key, value) => {
  for (const b of $(sel).children) b.setAttribute("aria-checked", String(b.dataset[key] === String(value)));
};

export const showPick = () => show("pick");

export function showHome() {
  renderHome();
  show("home");
}

/* ---------------- home ---------------- */

function renderHome() {
  const game = pickedGame() || "snooker";
  checkSegment("#game-pick", "game", game);
  checkSegment("#reds-pick", "reds", pick.reds);
  checkSegment("#target-pick", "target", pick.target);
  $("#reds-block").hidden = game !== "snooker";
  $("#learn-title").textContent = game === "pool" ? "New to pool?" : "New to snooker?";
  $("#learn-note").textContent = game === "pool" ? "How 8-ball works in 1 minute: solids and stripes, fouls, and the 8. The app guides you at every shot." : "How it works in 1 minute: the balls, the order, what a foul is. The app guides you at every shot.";
  $("#online-note").hidden = true;

  const rows = [];
  const row = (open, label, sub, removeLabel, remove) =>
    h("div", { class: "resume-row" }, btn([h("span", { text: label }), h("small", { text: sub })], open, "btn big"), btn("✕", remove, "icon-btn", { "aria-label": removeLabel, title: removeLabel }));
  // saved matches of both games (the one picked first), so switching games never hides one
  for (const g of [game, ...Object.keys(GAMES).filter((x) => x !== game)]) {
    const saved = loadLocal(g);
    if (!saved) continue;
    const s = replay(saved);
    const [a, b] = saved.players;
    const won = gamesWon(saved);
    const bits = [GAMES[g].label, `game ${saved.frames.length}`, `games ${won.join("–")}`, targetWords(saved.target), s.over ? "finished" : ""].filter(Boolean);
    const open = () => {
      pickGame(g);
      nav.openLocal(saved);
    };
    rows.push(
      row(open, `Carry on: ${a} v ${b}`, bits.join(" · "), "Delete this match", () =>
        confirmSheet("Delete this match?", `${a} v ${b}: every game and score on this phone goes.`, "Delete", () => {
          deleteLocal(g);
          renderHome();
        })
      )
    );
  }
  const recent = Object.entries(seats()).sort((x, y) => y[1].at - x[1].at)[0];
  if (recent && Date.now() - recent[1].at < 2 * 86400_000) {
    const [id, seat] = recent;
    rows.push(
      row(() => nav.openShared(id, true), "Back to your shared game", [seat.kind ? GAMES[seat.kind === "pool" ? "pool" : "snooker"].label : "", (seat.names || []).filter(Boolean).join(" v ") || id].filter(Boolean).join(" · "), "Remove from this phone", () =>
        confirmSheet("Remove this shared game?", "It's taken off this phone and you lose your seat in it. The other side keeps their copy.", "Remove", () => {
          forgetSeat(id);
          renderHome();
        })
      )
    );
  }
  $("#resume").hidden = !rows.length;
  $("#resume").replaceChildren(...rows);
}

async function startShared() {
  const b = $("#start-online");
  b.disabled = true;
  try {
    const id = await sync.create({ game: pickedGame() || "snooker", reds: pick.reds, target: pick.target });
    nav.openShared(id, true);
  } catch (err) {
    const note = $("#online-note");
    note.hidden = false;
    note.textContent = `${err.message} You can still score on this phone.`;
  } finally {
    b.disabled = false;
  }
}

/* ---------------- who's playing? (this phone) ---------------- */

/** Last names typed: { names: [side, side], teams: [[a, b], [c, d]], teamNames: [t, t] } */
function lastNames() {
  const singles = store.read(store.KEYS.names, ["", ""]);
  const doubles = store.read(store.KEYS.teams, {});
  return {
    names: Array.isArray(singles) ? singles : ["", ""],
    teams: Array.isArray(doubles.teams) ? doubles.teams : [["", ""], ["", ""]],
    teamNames: Array.isArray(doubles.teamNames) ? doubles.teamNames : ["", ""],
  };
}

function showLocalSetup() {
  if (!history.state?.screen) history.pushState({ screen: "local" }, ""); // Back returns home
  const game = pickedGame() || "snooker";
  const words = [game === "snooker" ? `${pick.reds} reds` : "", targetWords(pick.target)].filter(Boolean).join(", ");
  $("#local-game").replaceChildren("Playing ", h("b", { text: GAMES[game].label.toLowerCase() }), words ? ` (${words})` : "");
  checkSegment("#side-pick", "sides", pick.doubles ? 2 : 1);
  checkSegment("#break-pick", "b", pick.breaker);
  renderSides();
  show("local");
}

const input = (name, label, value, placeholder) => h("label", { class: "field" }, h("span", { text: label }), h("input", { name, maxlength: "24", placeholder, value: value || "", enterkeyhint: "next", autocomplete: "off" }));

function renderSides() {
  const last = lastNames();
  const box = $("#side-fields");
  if (!pick.doubles) {
    box.replaceChildren(input("p0", "Player 1", last.names[0], "Player 1"), input("p1", "Player 2", last.names[1], "Player 2"));
  } else {
    box.replaceChildren(
      ...[0, 1].map((t) =>
        h(
          "fieldset",
          { class: "team" },
          h("legend", { text: `Team ${t + 1}` }),
          input(`t${t}`, "Team name (optional)", last.teamNames[t], t ? "e.g. The Blues" : "e.g. The Pinks"),
          h("div", { class: "pair" }, input(`t${t}a`, "Player", last.teams[t]?.[0], t ? "Player C" : "Player A"), input(`t${t}b`, "Partner", last.teams[t]?.[1], t ? "Player D" : "Player B"))
        )
      )
    );
  }
  syncBreakPick();
}

/** The two sides as typed so far: { players: [name, name], teams }. */
function sidesFromForm() {
  const f = $("#local-form");
  const val = (name) => (f.elements[name]?.value || "").trim().slice(0, 24);
  if (!pick.doubles) return { players: [val("p0") || "Player 1", val("p1") || "Player 2"], teams: null };
  const teams = [0, 1].map((t) => cleanTeam([val(`t${t}a`), val(`t${t}b`)]));
  const players = [0, 1].map((t) => (val(`t${t}`) || teams[t].join(" & ") || `Team ${t + 1}`).slice(0, 24));
  return { players, teams };
}

function syncBreakPick() {
  const { players } = sidesFromForm();
  const labels = { 0: players[0], toss: "Coin toss", 1: players[1] };
  for (const b of $("#break-pick").children) b.textContent = labels[b.dataset.b];
}

function startLocal(e) {
  e.preventDefault();
  const { players, teams } = sidesFromForm();
  if (!pick.doubles) store.write(store.KEYS.names, players);
  else {
    const f = $("#local-form");
    store.write(store.KEYS.teams, { teams, teamNames: [0, 1].map((t) => f.elements[`t${t}`].value.trim()) });
  }
  const game = pickedGame() || "snooker";
  const start = (breaker) => {
    closeSheet();
    nav.openLocal(createMatch({ game, players, teams, target: pick.target, reds: pick.reds, breaker }));
  };
  if (pick.breaker !== "toss") return start(+pick.breaker);
  tossSheet({
    title: "Who breaks?",
    intro: `Heads for ${players[0]}, tails for ${players[1]}. The winner chooses who breaks.`,
    names: players,
    after: (w) => [btn(`${players[w]} breaks`, () => start(w), "btn primary big"), btn(`${players[1 - w]} breaks instead`, () => start(1 - w), "btn")],
  });
}
