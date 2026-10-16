// The page: views, the ball pad, guidance, the foul sheet, the re-spot helper, quick answers,
// and keeping a shared game in step. All the rules live in engine.js.

import { BALLS, COLOURS, VALUE, ballsOn, firstOn, judgePot, judgeShot, OTHER_FOULS, replayFrame, framesWon, newMatch, nextFrame, standing } from "./engine.js";
import { QA, TOPICS, context, search, suggestions, byId } from "./rules.js";
import * as SNK from "./engine.js";
import * as SNKQ from "./rules.js";
import * as POOL from "./pool.js";
import * as POOLQ from "./pool-rules.js";
import { poolUI } from "./pool-ui.js";
import { poolSVG } from "./pool-table.js";
import { tableSVG, setupSVG, spotOrder, SPOT_WORDS } from "./table.js";
import { api, seatFor, keepSeat, forgetSeat, seats } from "./api.js";
import { installWay, installPlace, appleGuide, canOpenSafari, onInstallChange, promptInstall } from "./install.js";
import { guideArt } from "./guide.js";

const $ = (sel) => document.querySelector(sel);
const LOCAL = { snooker: "snooker.local", pool: "chalk.pool.local" }; // the snooker key predates pool
const GAME = "chalk.game";
const NAMES = "snooker.names";
const POLL_MS = 2500;
const cap = (w) => w[0].toUpperCase() + w.slice(1);

/* ------------------------------------------------------------------ */
/* Tiny DOM builder: text is always text; html only for our own SVG    */
/* ------------------------------------------------------------------ */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v; // trusted, static markup only
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const btn = (label, onClick, cls = "btn", attrs = {}) => h("button", { type: "button", class: cls, on: { click: onClick }, ...attrs }, label);
const dot = (ball, cls = "dot") => h("span", { class: cls, "data-ball": ball, "aria-hidden": "true" });

/** **bold**, "• " bullet lines and paragraphs, from text that may contain player names. */
function rich(text) {
  const frag = document.createDocumentFragment();
  let list = null;
  for (const line of text.split("\n")) {
    const bullet = line.startsWith("• ");
    const p = h(bullet ? "li" : "p");
    line
      .replace(/^• /, "")
      .split(/(\*\*[^*]+\*\*)/)
      .forEach((part) => p.append(part.startsWith("**") && part.endsWith("**") ? h("b", { text: part.slice(2, -2) }) : document.createTextNode(part)));
    if (bullet) {
      if (!list) frag.append((list = h("ul")));
      list.append(p);
    } else {
      list = null;
      frag.append(p);
    }
  }
  return frag;
}

let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
const buzz = () => navigator.vibrate?.(8);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let mode = null; // "local" | "online"
let match = null; // { players, reds, frames: [{ breaker, events }] }
const online = { id: null, v: 0, seat: null, token: null, game: null, busy: false, timer: null, down: false, queue: Promise.resolve(), pending: 0, run: 0 };
const ui = { spotKey: "", spotStep: 0, spotFall: 0, foulDone: "", seen: new Set(), game: null, gateKey: "", setupDone: new Set(), spotDone: "", sheetKind: null, sheetLocked: false, redsPick: 15, breakPick: "0", watch: null };

const gameOf = (m) => (m && m.game === "pool" ? "pool" : "snooker");
const isPool = (m = match) => gameOf(m) === "pool";
const eng = (m = match) => (isPool(m) ? POOL : SNK);
/** Quick answers for the game being played (or picked on the home screen). */
const rulebook = () => (match ? isPool() : ui.game === "pool") ? POOLQ : SNKQ;
const state = () => eng().replayFrame(match);
const names = () => (match ? match.players.map((n, i) => n || `Player ${i + 1}`) : ["Player 1", "Player 2"]);
const frameNo = () => match.frames.length;
const eventsNow = () => match.frames[match.frames.length - 1].events;
const evKey = () => `${frameNo()}:${eventsNow().length}`;

function can(what, s = state()) {
  const ev = eventsNow();
  const rules = {
    turn: !s.over && !s.toss && !s.choice,
    toss: !!s.toss,
    next: s.over,
    concede: !s.over,
    undo: ev.length > 0 || (mode === "local" && match.frames.length > 1),
  }[what];
  if (!rules || mode === "local") return !!rules;
  // shared game: only your own side, and only once both sides are in
  const me = online.seat;
  if (me === null || !online.game || online.game.players.includes(null)) return false;
  if (what === "turn") return s.turn === me;
  if (what === "undo") return ev.length > 0 && ev[ev.length - 1].by === me;
  return true;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function show(view) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `view-${view}`;
  if (view === "game") wake(true);
  else wake(false);
  window.scrollTo(0, 0);
}

function goHome() {
  stopPolling();
  mode = null;
  match = null;
  Object.assign(online, { id: null, v: 0, seat: null, token: null, game: null, run: online.run + 1 });
  if (location.search) history.pushState(null, "", location.pathname);
  renderHome();
  show("home");
}

function pickGame(game) {
  ui.game = game;
  try {
    localStorage.setItem(GAME, game);
  } catch {}
}

function renderHome() {
  const pool = ui.game === "pool";
  for (const b of $("#game-pick").children) b.setAttribute("aria-checked", String(b.dataset.game === ui.game));
  $("#reds-block").hidden = pool;
  $("#learn-title").textContent = pool ? "New to pool?" : "New to snooker?";
  $("#learn-note").textContent = pool ? "How 8-ball works in 1 minute: solids and stripes, fouls, and the 8. The app guides you at every shot." : "How it works in 1 minute: the balls, the order, what a foul is. The app guides you at every shot.";
  const resume = $("#resume");
  resume.replaceChildren();
  const saved = loadLocal(ui.game);
  const parts = [];
  const item = (open, label, sub, removeLabel, remove) =>
    h(
      "div",
      { class: "resume-row" },
      btn([h("span", { text: label }), h("small", { text: sub })], open, "btn big"),
      btn("✕", remove, "icon-btn", { "aria-label": removeLabel, title: removeLabel })
    );
  if (saved) {
    const s = eng(saved).replayFrame(saved);
    const n = saved.players;
    parts.push(
      item(() => openLocal(saved), `Carry on: ${n[0]} v ${n[1]}`, `${isPool(saved) ? "8-ball" : "Snooker"} · game ${saved.frames.length}${isPool(saved) ? ` · games ${eng(saved).framesWon(saved).join("–")}` : ` · ${s.scores[0]}–${s.scores[1]}`}${s.over ? " · finished" : ""}`, "Delete this match", () =>
        confirmSheet("Delete this match?", `${n[0]} v ${n[1]}: every game and score on this phone goes.`, "Delete", () => {
          deleteLocal(gameOf(saved));
          renderHome();
        })
      )
    );
  }
  const recent = Object.entries(seats()).sort((a, b) => b[1].at - a[1].at)[0];
  if (recent && Date.now() - recent[1].at < 2 * 86400_000) {
    const [id, s] = recent;
    parts.push(
      item(() => openOnline(id, true), "Back to your shared game", (s.names || []).filter(Boolean).join(" v ") || id, "Remove from this phone", () =>
        confirmSheet("Remove this shared game?", "It's taken off this phone and you lose your seat in it. The other side keeps their copy.", "Remove", () => {
          forgetSeat(id);
          renderHome();
        })
      )
    );
  }
  resume.hidden = !parts.length;
  resume.append(...parts);
  for (const b of $("#reds-pick").children) b.setAttribute("aria-checked", String(+b.dataset.reds === ui.redsPick));
}

function deleteLocal(game = gameOf(match)) {
  try {
    localStorage.removeItem(LOCAL[game]);
  } catch {}
}

/* ---------------- this phone ---------------- */

function loadLocal(game) {
  try {
    const m = JSON.parse(localStorage.getItem(LOCAL[game]) || "null");
    if (!m || !Array.isArray(m.frames) || !m.frames.length || gameOf(m) !== game) return null;
    eng(m).replayFrame(m); // throws if damaged
    return m;
  } catch {
    return null;
  }
}
function saveLocal() {
  try {
    localStorage.setItem(LOCAL[gameOf(match)], JSON.stringify(match));
  } catch {}
}

function openLocalSetup() {
  const form = $("#local-form");
  let last = ["", ""];
  try {
    last = JSON.parse(localStorage.getItem(NAMES) || '["",""]');
  } catch {}
  form.p0.value = last[0] || "";
  form.p1.value = last[1] || "";
  syncBreakPick();
  show("local");
}

function syncBreakPick() {
  const form = $("#local-form");
  const labels = [form.p0.value.trim() || "Player 1", "Toss", form.p1.value.trim() || "Player 2"];
  [...$("#break-pick").children].forEach((b, i) => {
    b.textContent = labels[i];
    b.setAttribute("aria-checked", String(b.dataset.b === ui.breakPick));
  });
}

function startLocal(e) {
  e.preventDefault();
  const form = e.target;
  const players = [form.p0.value.trim().slice(0, 24) || "Player 1", form.p1.value.trim().slice(0, 24) || "Player 2"];
  try {
    localStorage.setItem(NAMES, JSON.stringify(players));
  } catch {}
  let breaker = ui.breakPick === "toss" ? (Math.random() < 0.5 ? 0 : 1) : +ui.breakPick;
  if (ui.breakPick === "toss") toast(`Coin toss: ${players[breaker]} breaks`);
  openLocal(ui.game === "pool" ? POOL.newMatch({ players, breaker }) : newMatch({ players, reds: ui.redsPick, breaker }));
}

function openLocal(m) {
  stopPolling();
  mode = "local";
  match = m;
  saveLocal();
  if (location.search) history.pushState(null, "", location.pathname);
  render();
  show("game");
}

/* ---------------- shared games ---------------- */

async function startOnline() {
  const b = $("#start-online");
  b.disabled = true;
  try {
    const r = await api.create(ui.redsPick, ui.game);
    history.pushState(null, "", `?g=${r.id}`);
    await openOnline(r.id);
  } catch (err) {
    showOnlineNote(err);
  } finally {
    b.disabled = false;
  }
}

function showOnlineNote(err) {
  const note = $("#online-note");
  note.hidden = false;
  note.textContent = `${err.message} You can still score on this phone.`;
}

async function openOnline(id, push = false) {
  stopPolling();
  if (push) history.pushState(null, "", `?g=${id}`);
  mode = "online";
  Object.assign(online, { id, v: 0, game: null, seat: null, token: null, run: online.run + 1 });
  const mine = seatFor(id);
  if (mine) Object.assign(online, { seat: mine.seat, token: mine.token });
  $("#join-card").replaceChildren(h("p", { class: "note", text: "Loading the game…" }));
  show("join");
  try {
    applyServer(await api.get(id));
  } catch (err) {
    $("#join-card").replaceChildren(
      h("h2", { text: err.code === "no_game" ? "Game not found" : "Couldn't open the game" }),
      h("p", { class: "note", text: err.message }),
      btn("Try again", () => openOnline(id), "btn"),
      btn("Score on this phone instead", openLocalSetup, "btn ghost")
    );
    return;
  }
  startPolling();
}

function applyServer(r) {
  if (!r || r.same) return;
  // a restart both sides agreed to: the balls need setting up again
  const asked = match && match.frames && match.frames.length && match.frames[match.frames.length - 1].ask;
  const now = r.game.frames[r.game.frames.length - 1];
  if (asked && now && !now.ask && !now.events.length) ui.setupDone.clear();
  online.v = r.v;
  online.game = r.game;
  match = { game: r.game.kind === "pool" ? "pool" : "snooker", players: r.game.players, reds: r.game.reds, frames: r.game.frames };
  if (online.seat !== null) keepSeat(online.id, online.seat, online.token, r.game.players);
  route();
}

/** Lobby/join until both sides are in, then the game (for players and watchers alike). */
function route() {
  const g = online.game;
  const ready = g.frames.length > 0;
  const watching = online.seat === null && !g.players.includes(null);
  if (ready && (online.seat !== null || watching || ui.watch === online.id)) {
    if ($("#view-game").hidden) show("game");
    render();
  } else {
    renderJoin();
    if ($("#view-join").hidden) show("join");
  }
}

function shareUrl() {
  return `${location.origin}${location.pathname}?g=${online.id}`;
}
async function shareLink() {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Chalk", text: isPool() ? "Join my 8-ball pool game:" : "Join my snooker game:", url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast("Couldn't copy: press and hold the link instead");
  }
}

function renderJoin() {
  const g = online.game;
  const card = $("#join-card");
  const seatsRow = h(
    "div",
    { class: "seats" },
    g.players.map((n, i) =>
      h("div", { class: `seat${n ? "" : " open"}` }, h("small", { text: online.seat === i ? "You" : `Side ${i + 1}` }), h("b", { text: n || "Open" }))
    )
  );
  const link = h("div", { class: "share-link", text: shareUrl() });
  if (online.seat !== null) {
    card.replaceChildren(
      h("h2", {}, h("span", { class: "pulse-dot", "aria-hidden": "true" }), "Waiting for the other side"),
      h("p", { class: "note", text: `Send this link to your opponent. They open it, type their name, and the coin toss decides who breaks. ${g.kind === "pool" ? "8-ball pool." : `Snooker, ${g.reds} reds.`}` }),
      seatsRow,
      link,
      h("div", { class: "row" }, btn("Share link", shareLink, "btn primary"))
    );
    return;
  }
  const full = !g.players.includes(null);
  const input = h("input", { name: "name", maxlength: "24", placeholder: "e.g. Parth, or Team Pink", autocomplete: "nickname", enterkeyhint: "go", required: true });
  try {
    const last = JSON.parse(localStorage.getItem(NAMES) || "[]");
    if (last[0]) input.value = last[0];
  } catch {}
  const form = h(
    "form",
    {
      class: "card-form",
      on: {
        submit: async (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (!name) return input.focus();
          const go = form.querySelector("button[type=submit]");
          go.disabled = true;
          try {
            const r = await api.join(online.id, name);
            Object.assign(online, { seat: r.seat, token: r.token });
            keepSeat(online.id, r.seat, r.token, r.game.players);
            try {
              localStorage.setItem(NAMES, JSON.stringify([name, ""]));
            } catch {}
            applyServer(r);
            if (r.game.frames.length) toast(`Coin toss: ${r.game.players[r.game.frames[0].breaker]} breaks`);
          } catch (err) {
            toast(err.message);
            go.disabled = false;
            if (err.code === "full") applyServer(await api.get(online.id).catch(() => null));
          }
        },
      },
    },
    h("label", { class: "field" }, h("span", { text: "Your name or team" }), input),
    h("button", { type: "submit", class: "btn primary big" }, h("span", { text: "Join and play" }))
  );
  form.style.cssText = "display:flex;flex-direction:column;gap:12px";
  card.replaceChildren(
    h("h2", { text: full ? "Both sides are playing" : g.players.some(Boolean) ? `${g.players.find(Boolean)} invited you` : "New snooker game" }),
    h("p", { class: "note", text: full ? "You can watch the score live." : `${g.kind === "pool" ? "8-ball pool" : `Snooker, ${g.reds} reds`}. Type your name and you're in. Each side scores their own turns; everyone sees everything.` }),
    seatsRow,
    full ? null : form,
    g.frames.length
      ? btn(
          "Just watch",
          () => {
            ui.watch = online.id;
            route();
          },
          "btn ghost"
        )
      : null
  );
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    if (mode !== "online" || !online.id) return;
    if (document.visibilityState === "visible" && !online.busy) {
      try {
        const r = await api.get(online.id, online.v);
        if (online.down) {
          online.down = false;
          renderTag();
        }
        if (!online.busy) applyServer(r);
      } catch (err) {
        if (!online.down) {
          online.down = true;
          renderTag();
        }
      }
    }
    online.timer = setTimeout(tick, POLL_MS);
  };
  online.timer = setTimeout(tick, POLL_MS);
}
function stopPolling() {
  clearTimeout(online.timer);
  online.timer = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && mode === "online" && online.id && !online.busy)
    api
      .get(online.id, online.v)
      .then(applyServer)
      .catch(() => {});
  if (document.visibilityState === "visible" && !$("#view-game").hidden) wake(true);
});

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

async function dispatch(e) {
  buzz();
  if (mode === "local") {
    const before = structuredClone(match);
    if (e.t === "undo") undoLocal();
    else if (e.t === "next") match = eng().nextFrame(match);
    else eventsNow().push(e);
    try {
      state();
    } catch {
      match = before;
      toast("That doesn't fit the game right now");
    }
    saveLocal();
    render();
    return;
  }
  // shared game: show it straight away, then send moves to the Worker one at a time, in order.
  // (Sent together, a later move can arrive first: a black before the red it follows.)
  if (e.t === "undo") eventsNow().pop();
  else if (e.t === "next") match = eng().nextFrame(match);
  else if (e.t !== "restart" && e.t !== "restart-no") eventsNow().push({ ...e, by: online.seat });
  render();
  const run = online.run;
  online.pending++;
  online.busy = true;
  online.queue = online.queue.then(async () => {
    if (run !== online.run) return; // an earlier move failed, and this one was built on it
    try {
      const r = await api.act(online.id, online.token, online.v, e);
      online.v = r.v;
      online.game = r.game;
      if (online.pending === 1) applyServer(r); // later moves are still on their way: keep showing them
    } catch (err) {
      online.run++;
      toast(err.code === "stale" ? "The other phone just changed something. Have another look." : err.message);
      try {
        applyServer(err.data && err.data.game ? err.data : await api.get(online.id));
      } catch {
        if (online.game) applyServer({ v: online.v, game: online.game });
      }
    } finally {
      online.pending--;
      online.busy = online.pending > 0;
    }
  });
}

function undoLocal() {
  const ev = eventsNow();
  if (ev.length) ev.pop();
  else if (match.frames.length > 1) match.frames.pop();
}

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
  if (s.phase === "colour" && ball !== "red" && s.called !== ball) return dispatch({ t: "call", ball });
  const j = judgePot(s, ball);
  if (j.ok && j.extra) return dispatch({ t: "pot", ball, extra: true }); // the button says "another red in, same shot"
  if (j.ok) return dispatch({ t: "pot", ball });
  if (j.reason !== "foul") return;
  const intro =
    s.phase === "red"
      ? `You're on a red, so the white has to hit a red first, and only reds may go in. What happened with the ${ball}?`
      : s.phase === "colour"
        ? `You called the ${s.called}. What happened with the red?`
        : `You're on the ${COLOURS[s.next]}. What happened with the ${ball}?`;
  shotSheet(ball === "red" ? { reds: 1 } : { first: ball }, intro);
}

/* ------------------------------------------------------------------ */
/* Game screen                                                         */
/* ------------------------------------------------------------------ */

function render() {
  if (!match || !match.frames.length) return;
  const s = state();
  if (isPool()) return renderPool(s);
  renderTag(s);
  renderPlayers(s);
  renderStanding(s);
  renderGuide(s);
  renderPad(s);
  renderActions(s);
  renderLog(s);
  gates(s);
}

/* ---------------- 8-ball pool: the shared shell, pool's own pieces ---------------- */

const pool = poolUI({
  h,
  btn,
  openSheet: (...a) => openSheet(...a),
  closeSheet: () => closeSheet(),
  dispatch: (e) => dispatch(e),
  toast: (t) => toast(t),
  can: (w, s) => can(w, s),
  state: () => state(),
  names: () => names(),
  frameNo: () => frameNo(),
  evKey: () => evKey(),
  match: () => match,
  mode: () => mode,
  online,
  render: () => render(),
  learn: (i) => learnSheet(i),
});

function renderPool(s) {
  const n = names();
  renderTag(s);
  const won = eng().framesWon(match);
  const card = (p) => {
    const b = pool.playerBody(s, p);
    return h(
      "div",
      { class: `player${!s.over && s.turn === p ? " at" : ""}`, "aria-label": `${n[p]}: ${b.big} ${b.sub}` },
      h("div", { class: "p-name" }, h("span", { text: n[p] }), mode === "online" && online.seat === p ? h("span", { class: "p-you", text: "YOU" }) : null),
      h("div", { class: "p-score pool-score", text: b.big }),
      h("div", { class: "p-sub" }, b.sub),
      b.dots
    );
  };
  $("#players").replaceChildren(card(0), h("div", { class: "frames" }, h("b", { text: `${won[0]}–${won[1]}` }), h("small", { text: "GAMES WON" })), card(1));
  $("#standing").replaceChildren(...[].concat(pool.standing(s, n)));
  const cards = [];
  const alerts = [];
  pool.guide(s, n, cards, alerts);
  $("#guide").replaceChildren(...cards);
  $("#alerts").replaceChildren(...alerts);
  markNew();
  const padEl = $("#pad");
  padEl.classList.add("pool-pad");
  padEl.classList.toggle("locked", !can("turn", s));
  padEl.replaceChildren(...pool.pad(s));
  const turn = can("turn", s);
  $("#btn-miss").disabled = !turn;
  $("#btn-foul").disabled = !turn;
  $("#btn-miss").replaceChildren(h("b", { text: s.breakShot ? "Log the break" : "Missed" }), h("small", { text: s.breakShot ? "after the balls stop" : "no foul, nothing in" }));
  $("#btn-undo").disabled = !can("undo", s);
  const last = eventsNow()[eventsNow().length - 1];
  $("#undo-sub").textContent = !last ? (match.frames.length > 1 ? "new game" : "last tap") : last.t === "choose" ? "the choice" : last.t === "concede" ? "give up" : "last shot";
  const rows = pool.logRows(s, n).filter(Boolean);
  $("#log").replaceChildren(...(rows.length ? rows : [h("li", { class: "info empty", text: "Nothing potted yet. Tap a ball when it drops." })]));
  // racking and putting the 8 back: pop-ups that only close once done
  const gate = pool.gates(s, ui);
  const allowed = gate && (mode === "local" || (gate.kind === "setup" ? online.seat !== null : can("turn", s) || (s.spot8 && online.seat === s.turn)));
  if (allowed) {
    if (ui.sheetKind !== gate.kind || ui.gateKey !== gate.key) {
      ui.gateKey = gate.key;
      gate.open();
    }
  } else if (ui.sheetKind === "spot" || ui.sheetKind === "setup") closeSheet();
}

/** Only cards that just appeared slide in; the rest stay still while you tap. */
function markNew() {
  const keys = new Set();
  for (const c of document.querySelectorAll("#guide .g-card, #alerts .g-card")) {
    const k = c.dataset.key;
    if (!k) continue;
    keys.add(k);
    if (!ui.seen.has(k)) c.classList.add("new");
  }
  ui.seen = keys;
}

/**
 * Steps that must happen at the table before the next shot, each in a pop-up that only
 * closes once it's done: set up the table at the start of a game, put potted colours back.
 * Only on a phone that can play (in a shared game, the side at the table).
 */
function gates(s) {
  const setupKey = `${mode}:${online.id || "local"}:${frameNo()}`;
  if (!eventsNow().length && !s.over && !ui.setupDone.has(setupKey) && (mode === "local" || online.seat !== null)) {
    if (ui.sheetKind !== "setup") setupSheet(setupKey);
    return;
  }
  if (s.toSpot.length && !s.toss && ui.spotDone !== evKey() && (mode === "local" || can("turn", s))) {
    if (ui.sheetKind !== "spot" || ui.spotKey !== evKey()) spotSheet(s);
    return;
  }
  if (ui.sheetKind === "spot" || ui.sheetKind === "setup") closeSheet(); // e.g. undone on the other phone
}

function setupSheet(key) {
  const n = names();
  const breaker = n[match.frames[frameNo() - 1].breaker];
  const d = (b) => dot(b);
  openSheet(
    `Game ${frameNo()}: set up the table`,
    { locked: true, kind: "setup" },
    h("p", { class: "lead-text" }, "Put the balls out exactly like this. ", h("b", { text: `${breaker} breaks first.` })),
    h("div", { class: "table-wrap", html: setupSVG(match.reds) }),
    h(
      "ol",
      { class: "steps" },
      h("li", {}, h("span", {}, "Stand at the end with the ", h("b", { text: "D" }), " (the half circle). You break from here.")),
      h("li", {}, h("span", {}, "On the line: ", d("green"), h("b", { text: "green" }), " on the left corner of the D, ", d("brown"), h("b", { text: "brown" }), " in the middle, ", d("yellow"), h("b", { text: "yellow" }), " on the right corner.")),
      h("li", {}, h("span", {}, d("blue"), h("b", { text: "Blue" }), " on the spot in the very middle of the table.")),
      h("li", {}, h("span", {}, d("pink"), h("b", { text: "Pink" }), " on the spot halfway between the blue and the far cushion.")),
      h("li", {}, h("span", {}, d("red"), h("b", { text: `${match.reds} reds` }), " packed in a triangle just behind the pink, point towards it but not touching. A triangle frame makes this easy.")),
      h("li", {}, h("span", {}, d("black"), h("b", { text: "Black" }), " on the spot near the far cushion.")),
      h("li", {}, h("span", {}, d("white"), h("b", { text: "White" }), ` anywhere inside the D. ${breaker} plays it at the reds.`))
    ),
    btn("The table is ready", () => {
      ui.setupDone.add(key);
      closeSheet();
      render();
    }, "btn primary big"),
    btn("New to snooker? How it works", () => learnSheet(0), "link")
  );
}

/** "Put the pink back": a pop-up that stays until the ball is back on the table. */
function spotSheet(s) {
  const key = evKey();
  if (ui.spotKey !== key) Object.assign(ui, { spotKey: key, spotStep: 0, spotFall: 0 });
  const ball = s.toSpot[ui.spotStep];
  const order = spotOrder(ball);
  const all = ui.spotFall >= order.length;
  const at = all ? ball : order[ui.spotFall];
  const later = s.toSpot.slice(ui.spotStep + 1);
  const why = s.foul ? "Colours that go in on a foul always come back." : s.reds > 0 || s.phase === "clear" ? "While there are reds left, colours come back on the table after they're potted." : "The colour after the last red comes back too. From now on they stay down.";
  let where;
  if (all) where = `Every spot is covered: put it as close to its own spot as you can, towards the far cushion${ball === "pink" || ball === "black" ? " (if that's blocked, straight below its spot)" : ""}, not touching another ball.`;
  else if (at === ball) where = `On its own spot: ${SPOT_WORDS[ball]}.`;
  else where = `Its own spot is covered, so use the highest free spot: the ${at} spot (${SPOT_WORDS[at]}).`;
  const done = () => {
    ui.spotStep++;
    ui.spotFall = 0;
    if (ui.spotStep >= s.toSpot.length) {
      ui.spotDone = key;
      closeSheet();
      render();
    } else spotSheet(state());
  };
  openSheet(
    `Put the ${ball} back on the table`,
    { locked: true, kind: "spot" },
    h("p", { class: "lead-text", text: why }),
    h("div", { class: "spot-pop" }, h("div", { class: "table-wrap", html: tableSVG({ spot: all ? ball : at, ball, labels: true }) }), h("p", { class: "lead-text" }, h("b", { text: where }))),
    btn(later.length ? `Done. Next: the ${later[0]}` : all ? `The ${ball} is back on the table` : at === ball ? `The ${ball} is back on its spot` : `The ${ball} is on the ${at} spot`, done, "btn primary big"),
    all ? null : btn(ui.spotFall ? "That spot's covered too" : "Its spot is covered by another ball", () => {
      ui.spotFall++;
      spotSheet(state());
    }, "btn"),
    can("undo", s)
      ? btn(`Oops, the ${ball} didn't go in (undo)`, () => {
          closeSheet();
          dispatch({ t: "undo" });
        }, "link")
      : null
  );
}

const LESSONS = [
  ["The idea", () => [h("p", {}, "Take turns hitting the ", h("b", { text: "white ball" }), " with your cue to knock the coloured balls into the pockets (", h("b", { text: "potting" }), "). Each ball you pot scores points. More points when the table's cleared wins the game.")]],
  [
    "What each ball is worth",
    () => [
      h("div", { class: "balls-row" }, ["red", "yellow", "green", "brown", "blue", "pink", "black"].map((b) => h("span", { class: "v" }, dot(b), String(VALUE[b])))),
      h("p", {}, "There are 15 reds (1 point each) and six colours. You only ever hit the white with the cue."),
    ],
  ],
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
  [
    "Fouls",
    () => [
      h("p", {}, "Hit the wrong ball first, miss everything, or put the white in a pocket? That's a ", h("b", { text: "foul" }), ": the other player gets 4 to 7 points."),
      h("p", {}, "Not sure? Tap ", h("b", { text: "What happened?" }), ", answer two questions, and the app tells you."),
    ],
  ],
  ["Games and matches", () => [h("p", {}, "Snooker players call one game a ", h("b", { text: "frame" }), ". Play as many as you like: the app counts ", h("b", { text: "games won" }), " and you take turns to break."), h("p", {}, "The app tells you what to do at every step. You just tap what happened.")]],
];

function learnSheet(i = 0) {
  const poolGame = match ? isPool() : ui.game === "pool";
  const lessons = poolGame ? pool.LESSONS : LESSONS;
  const [title, body] = lessons[i];
  const last = i === lessons.length - 1;
  openSheet(
    poolGame ? "How 8-ball pool works" : "How snooker works",
    h("div", { class: "lesson" }, h("h3", { text: `${i + 1}. ${title}` }), ...body()),
    h("div", { class: "lesson-dots", "aria-hidden": "true" }, lessons.map((_, j) => h("i", { class: j === i ? "now" : "" }))),
    h(
      "div",
      { class: "row" },
      i ? btn("Back", () => learnSheet(i - 1), "btn") : null,
      btn(last ? "Got it" : "Next", () => {
        if (!last) return learnSheet(i + 1);
        closeSheet();
        if (match && !$("#view-game").hidden) render();
      }, "btn primary")
    )
  );
}

/** One quick answer on its own, e.g. "what's a frame?" from the header. */
function answerSheet(id) {
  const book = rulebook();
  const e = book.byId(id);
  openSheet(e.q, h("div", { class: "qa-solo" }, rich(e.a(book.context(match ? state() : null, names())))));
}

function setTheme(light) {
  try {
    if (light) localStorage.setItem("snooker.theme", "light");
    else localStorage.removeItem("snooker.theme");
  } catch {}
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f6f5f1" : "#131a17");
}

function renderTag(s = state()) {
  if (!match) return;
  const tag = $("#frame-tag");
  tag.replaceChildren(h("button", { type: "button", class: "frame-help", on: { click: () => answerSheet(isPool() ? "p-how" : "what-frame") } }, "Game ", h("b", { text: String(frameNo()) })), isPool() ? " · 8-ball" : ` · ${match.reds} reds`);
  if (mode === "online") {
    tag.append(" · ", h("span", { class: "live", text: online.down ? "reconnecting…" : online.seat === null ? "watching live" : "live" }));
  }
}

function renderPlayers(s) {
  const n = names();
  const won = framesWon(match);
  $("#pad").classList.remove("pool-pad");
  const card = (p) =>
    h(
      "div",
      { class: `player${!s.over && !s.toss && s.turn === p ? " at" : ""}`, "aria-label": `${n[p]}: ${s.scores[p]}` },
      h("div", { class: "p-name" }, h("span", { text: n[p] }), mode === "online" && online.seat === p ? h("span", { class: "p-you", text: "YOU" }) : null),
      h("div", { class: "p-score", text: String(s.scores[p]) }),
      h("div", { class: "p-sub" }, ...(s.turn === p && s.brk > 0 && !s.over ? ["Break ", h("b", { text: String(s.brk) })] : s.best[p] ? [`Best break ${s.best[p]}`] : []))
    );
  $("#players").replaceChildren(card(0), h("div", { class: "frames" }, h("b", { text: `${won[0]}–${won[1]}` }), h("small", { text: "GAMES WON" })), card(1));
}

function renderStanding(s) {
  const el = $("#standing");
  if (s.over) return el.replaceChildren();
  const st = standing(s);
  const n = names();
  el.replaceChildren(st.leader === null ? "Level" : `${n[st.leader]} leads by ${st.lead}`, ` · ${st.left} left on the table`);
  if (st.snookers) el.append(" · ", h("span", { class: "snk", text: `${n[1 - st.leader]} needs snookers` }));
}

function onColour(s) {
  if (s.phase === "red") return "red";
  if (s.phase === "clear") return COLOURS[s.next];
  return null;
}

function renderGuide(s) {
  const n = names();
  const cards = [];
  const alerts = [];
  const me = n[s.turn];

  if (s.over) {
    const w = s.winner;
    cards.push(
      h(
        "div",
        { class: "g-card", "data-key": `over-${frameNo()}` },
        h("p", { class: "g-kicker", text: s.conceded !== null ? `${n[s.conceded]} gave up this game` : `Game ${frameNo()} over` }),
        h("p", { class: "g-title", text: `${n[w]} wins, ${Math.max(...s.scores)}–${Math.min(...s.scores)}` }),
        h("p", { class: "g-text", text: `Highest breaks: ${n[0]} ${s.best[0]}, ${n[1]} ${s.best[1]}. (Snooker players call one game a "frame".)` }),
        can("next", s) ? h("div", { class: "row" }, btn(`Play game ${frameNo() + 1} · ${n[1 - match.frames[frameNo() - 1].breaker]} breaks`, () => dispatch({ t: "next" }), "btn primary")) : null
      )
    );
  }

  if (s.toss) {
    const level = s.scores[0];
    cards.push(
      h(
        "div",
        { class: "g-card spot", style: "--on: var(--black)", "data-key": `toss-${evKey()}` },
        h(
          "div",
          { class: "spot-copy" },
          h("p", { class: "g-kicker", text: `Level at ${level}` }),
          h("p", { class: "g-title", text: "Re-spotted black" }),
          h("p", { class: "g-text", text: "Black back on its spot. Toss a coin: the winner picks who plays, with the white in hand in the D. Next score or foul wins." }),
          can("toss", s) ? h("div", { class: "row" }, btn(`${n[0]} plays`, () => dispatch({ t: "toss", who: 0 }), "btn primary"), btn(`${n[1]} plays`, () => dispatch({ t: "toss", who: 1 }), "btn primary")) : null
        ),
        h("span", { html: tableSVG({ spot: "black", d: true, labels: false }) })
      )
    );
  }

  if (s.foul && ui.foulDone !== evKey()) {
    const off = n[s.foul.by];
    const inc = n[s.turn];
    const mine = can("turn", s);
    alerts.push(
      h(
        "div",
        { class: "g-card foul", "data-key": `foul-${evKey()}` },
        h("p", { class: "g-kicker", text: `Foul by ${off}` }),
        h("p", { class: "g-title", text: `${s.foul.pen} points to ${inc}` }),
        h(
          "p",
          { class: "g-text" },
          cap(s.foul.why),
          ". ",
          s.inHand
            ? [h("b", { text: "White in hand: anywhere in the D." }), " ", btn("Show me", () => pictureSheet("White in hand", "Anywhere inside the D, or on its lines. Pick it up and move it as often as you like until you play. Any direction is fine.", { d: true }), "link")]
            : "Play from where the white stopped. It's not ball in hand."
        ),
        mine
          ? h(
              "div",
              { class: "row" },
              btn("I'll play", () => {
                ui.foulDone = evKey();
                render();
              }, "btn primary"),
              btn(`${off} plays again`, () => dispatch({ t: "again" })),
              btn("Free ball (I'm snookered)", () => freeBallSheet()),
              btn("Put balls back (miss)", () => missSheet(off))
            )
          : h("p", { class: "g-text", text: `${inc} decides: play on, make ${off} play again, or take a free ball if snookered.` })
      )
    );
  }

  const ask = mode === "online" && match.frames[match.frames.length - 1].ask;
  if (ask) {
    const what = ask.all ? "start the whole match over (every game back to 0)" : "restart this game (scores back to 0)";
    const mineAsk = ask.by === online.seat;
    alerts.unshift(
      h(
        "div",
        { class: "g-card foul", "data-key": `ask-${ask.by}-${ask.all}` },
        h("p", { class: "g-kicker", text: "Restart?" }),
        h("p", { class: "g-title", text: mineAsk ? `Waiting for ${n[1 - ask.by]} to agree` : `${n[ask.by]} wants to ${what}` }),
        mineAsk
          ? h("div", { class: "row" }, btn("Cancel", () => dispatch({ t: "restart-no" })))
          : online.seat !== null
            ? h("div", { class: "row" }, btn("Agree", () => dispatch({ t: "restart", all: ask.all }), "btn warn"), btn("No, keep playing", () => dispatch({ t: "restart-no" })))
            : null
      )
    );
  }

  const spot = mode === "online" && !can("turn", s) ? spotCard(s) : null; // the phone at the table gets the pop-up
  if (spot) alerts.push(spot);

  if (!s.over && !s.toss) {
    let on = onColour(s);
    let kicker = `${me} · at the table`;
    let title;
    let text;
    let extra = null;
    if (s.respot) {
      title = "Re-spotted black";
      text = "Next score or foul wins the frame.";
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
      extra = h(
        "div",
        { class: "seq", "aria-hidden": "true" },
        COLOURS.map((c, i) => dot(c, `dot${i < s.next ? " done" : i === s.next ? " now" : ""}`))
      );
    }
    const card = h(
      "div",
      { class: "g-card", style: `--on: var(--${on || "accent"})` },
      h("p", { class: "g-kicker", text: kicker }),
      h("p", { class: "g-title", text: title }),
      h("p", { class: "g-text", text }),
      extra
    );
    if (s.inHand) {
      // white in hand: show the D right there, next to what's on
      if (eventsNow().length) card.append(h("p", { class: "g-text" }, h("b", { text: "White in hand: " }), "anywhere inside the D or on its lines, then play in any direction."));
      card.classList.add("spot", "in-hand");
      const copy = h("div", { class: "spot-copy" }, ...card.childNodes);
      card.replaceChildren(copy, h("span", { html: tableSVG({ d: true, labels: false }) }));
    }
    if (mode === "online" && !can("turn", s)) card.append(h("p", { class: "g-text", text: online.seat === null ? `${me}'s phone logs this visit.` : `${me} logs this visit on their phone. You'll see it here live.` }));
    cards.push(card);
  }
  $("#guide").replaceChildren(...cards);
  $("#alerts").replaceChildren(...alerts);
  // only cards that just appeared slide in; the rest stay still while you tap
  const keys = new Set();
  for (const c of document.querySelectorAll("#guide .g-card, #alerts .g-card")) {
    const k = c.dataset.key;
    if (!k) continue;
    keys.add(k);
    if (!ui.seen.has(k)) c.classList.add("new");
  }
  ui.seen = keys;
}

/** "Put the pink back": the spot on a little table, with a way through covered spots. */
function spotCard(s) {
  if (!s.toSpot.length || s.toss) return null;
  const key = evKey();
  if (ui.spotKey !== key) Object.assign(ui, { spotKey: key, spotStep: 0, spotFall: 0 });
  if (ui.spotStep >= s.toSpot.length) return null;
  const ball = s.toSpot[ui.spotStep];
  const order = spotOrder(ball);
  const all = ui.spotFall >= order.length;
  const at = all ? ball : order[ui.spotFall];
  const later = s.toSpot.slice(ui.spotStep + 1);
  let text;
  if (all) text = `Every spot is covered: place it as close to its own spot as you can, towards the far cushion${ball === "pink" || ball === "black" ? " (if that's blocked, straight below its spot)" : ""}, not touching another ball.`;
  else if (at === ball) text = `On its own spot: ${SPOT_WORDS[ball]}.`;
  else text = `Its spot is covered, so it goes on the highest free spot: the ${at} spot (${SPOT_WORDS[at]}).`;
  return h(
    "div",
    { class: "g-card spot", style: `--on: var(--${ball})`, "data-key": `spot-${key}-${ui.spotStep}-${ui.spotFall}` },
    h(
      "div",
      { class: "spot-copy" },
      h("p", { class: "g-kicker", text: later.length ? `Then: ${later.join(", ")}` : "Re-spot" }),
      h("p", { class: "g-title" }, `Put the ${ball} back`),
      h("p", { class: "g-text", text }),
      h(
        "div",
        { class: "row" },
        btn(
          "Done",
          () => {
            ui.spotStep++;
            ui.spotFall = 0;
            render();
          },
          "btn primary"
        ),
        all
          ? null
          : btn(ui.spotFall ? "That's covered too" : "Spot covered?", () => {
              ui.spotFall++;
              render();
            })
      )
    ),
    h("span", { html: tableSVG({ spot: all ? ball : at, ball, labels: false }) })
  );
}

function renderPad(s) {
  const on = ballsOn(s);
  const turn = can("turn", s);
  const pad = $("#pad");
  pad.classList.toggle("locked", !turn);
  const callable = s.phase === "colour" && !s.free;
  const balls = BALLS.map((b) => {
    const called = callable && s.called === b;
    const isOn = callable ? b !== "red" && (!s.called || called) : on.includes(b);
    const free = s.free && on.includes(b) && b !== "red" && !(s.phase === "clear" && b === COLOURS[s.next]);
    const extraRed = b === "red" && s.phase === "colour" && s.lastRed && s.reds > 0;
    const disabled = !turn || (b === "red" && s.reds === 0);
    const label = b === "red" ? `Red, ${s.reds} left` : `${cap(b)}, ${VALUE[b]}`;
    const tag = free ? "FREE" : called ? "CALLED" : callable && b !== "red" && !s.called ? "CALL" : null;
    return h(
      "button",
      {
        type: "button",
        class: `ball ${b === "red" ? "red" : ""} ${isOn ? "on" : extraRed ? "extra" : "off"}${called ? " called" : ""}${callable && b !== "red" && !s.called ? " callable" : ""}`,
        "data-ball": b,
        "aria-label": extraRed ? `Another red went in on the same shot (${s.reds} left)` : callable && b !== "red" ? (called ? `${label}: potted` : `Call the ${b}`) : `${label}${isOn ? "" : " (not on)"}`,
        disabled,
        on: { click: () => onBall(b) },
      },
      b === "red" ? (s.reds ? (extraRed ? ["Another red in, same shot", h("span", { class: "count", text: "+1" })] : ["Red", h("span", { class: "count", text: `× ${s.reds}` })]) : "No reds left") : String(VALUE[b]),
      tag ? h("span", { class: "tag", text: tag }) : null
    );
  });
  pad.replaceChildren(...balls, turn ? h("p", { class: "pad-hint", text: padHint(s) }) : null);
}

/** One plain line under the balls: what to tap now. */
function padHint(s) {
  if (s.free) return "Free ball: tap the colour you potted as the free ball, or a red if a red went in.";
  if (s.phase === "red") return "A red went in? Tap Red. Nothing went in? Tap Missed.";
  if (s.phase === "colour" && !s.called) return "Tap a colour to call it.";
  if (s.phase === "colour") return `Called the ${s.called}: tap it again when it goes in, or tap Missed.`;
  return `Tap the ${COLOURS[s.next]} when it goes in, or tap Missed.`;
}

function renderActions(s) {
  const turn = can("turn", s);
  $("#btn-miss").replaceChildren(h("b", { text: "Missed" }), h("small", { text: "nothing went in" }));
  $("#btn-miss").disabled = !turn;
  $("#btn-foul").disabled = !turn;
  $("#btn-undo").disabled = !can("undo", s);
  const last = eventsNow()[eventsNow().length - 1];
  $("#undo-sub").textContent = !last ? (match.frames.length > 1 ? "new game" : "last tap") : last.t === "pot" ? `the ${last.ball}` : last.t === "call" ? `${last.ball} call` : { miss: "the miss", foul: "the foul", again: "play again", replace: "put back", free: "free ball", toss: "the toss", concede: "concede" }[last.t] || "last tap";
}

function renderLog(s) {
  const n = names();
  const rows = [];
  let visit = null;
  const flush = () => {
    if (visit) rows.push(visit);
    visit = null;
  };
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
    if (l.t === "miss") continue; // the break just ends; the next visit shows who came in
    rows.push(l);
  }
  flush();
  const items = rows.reverse().map((r) => {
    if (r.kind === "visit")
      return h(
        "li",
        {},
        h("span", { class: "who", text: n[r.p] }),
        h("span", { class: "balls" }, r.balls.map((b) => (b.free ? h("span", {}, dot(b.ball), h("span", { class: "free", text: " FREE" })) : dot(b.ball)))),
        h("span", { class: "pts", text: `+${r.pts}` })
      );
    if (r.t === "foul") return h("li", { class: "foul" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls", text: `Foul${r.white ? " (in-off)" : ""} → ${n[r.to]}` }), h("span", { class: "pts", text: `+${r.pen}` }));
    const info = {
      again: `${n[r.p]} plays again`,
      replace: `Foul and a miss: balls put back, ${n[r.p]} plays again`,
      free: `${n[r.p]} takes a free ball`,
      respot: "Level: re-spotted black",
      concede: `${n[r.p]} conceded`,
    }[r.t];
    return info ? h("li", { class: "info", text: info }) : null;
  });
  $("#log").replaceChildren(...(items.length ? items : [h("li", { class: "info empty", text: "Nothing potted yet. Tap a ball when it drops." })]));
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

let lastFocus = null;
/** A bottom sheet. A "locked" one is a step you must finish (set up the table, put a colour back): no ✕, no tap-outside. */
function openSheet(title, ...body) {
  const opts = body[0] && body[0].locked !== undefined && !(body[0] instanceof Node) ? body.shift() : {};
  if ($("#sheet").hidden) lastFocus = document.activeElement;
  ui.sheetLocked = !!opts.locked;
  ui.sheetKind = opts.kind || null;
  const head = h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title", text: title }), opts.locked ? null : btn("✕", closeSheet, "icon-btn close", { "aria-label": "Close" }));
  $("#sheet-body").replaceChildren(head, ...body);
  $("#sheet").hidden = false;
  $("#scrim").hidden = false;
  $("#sheet-body").scrollTop = 0;
  ($("#sheet-body").querySelector("button") || head).focus?.({ preventScroll: true });
}
function closeSheet() {
  ui.sheetLocked = false;
  ui.sheetKind = null;
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  lastFocus?.focus?.({ preventScroll: true });
}
const softClose = () => !ui.sheetLocked && closeSheet();
$("#scrim").addEventListener("click", softClose);
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#sheet").hidden && softClose());

function freeBallSheet() {
  const s = state();
  const val = s.phase === "red" ? 1 : VALUE[COLOURS[s.next]];
  openSheet(
    "Free ball?",
    h(
      "p",
      { class: "lead-text" },
      "Only if the foul left you ",
      h("b", { text: "snookered" }),
      `: a ball that's not on blocks the white from hitting both sides of every ${s.phase === "red" ? "red" : `ball on (the ${COLOURS[s.next]})`}.`
    ),
    h("p", { class: "lead-text", text: `Then pick any colour as your ball on. Potted, it scores ${val} and goes back on its spot. You can't hide the white behind it.` }),
    btn("Take the free ball", () => {
      closeSheet();
      dispatch({ t: "free" });
    }, "btn primary big")
  );
}

function missSheet(off) {
  openSheet(
    "Foul and a miss",
    h("p", { class: "lead-text", text: `Use this when ${off} didn't make a proper attempt to hit the ball on. The balls go back where they were and ${off} plays the shot again. The penalty points stay.` }),
    h("p", { class: "lead-text", text: "Friendly games often skip this rule. Three misses in a row with a clear view of the ball on loses the frame." }),
    btn("Put the balls back", () => {
      closeSheet();
      dispatch({ t: "replace" });
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
  const me = n[s.turn];
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
      h(
        "div",
        { class: "chips" },
        order.map((b) => chip(cap(b), shot.first === b, set(() => (shot.first = b)), { ball: b, sub: onFirst.includes(b) ? "on" : null })),
        chip("Nothing", shot.first === "nothing", set(() => (shot.first = "nothing")))
      )
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
              h(
                "span",
                { class: "stepper" },
                btn("−", set(() => (shot.reds = Math.max(0, shot.reds - 1))), "", { "aria-label": "One red fewer" }),
                btn("+", set(() => (shot.reds = Math.min(s.reds, shot.reds + 1))), "", { "aria-label": "One more red" })
              )
            )
          : null,
        COLOURS.map((c) => chip(cap(c), shot.colours.has(c), set(() => (shot.colours.has(c) ? shot.colours.delete(c) : shot.colours.add(c))), { ball: c }))
      )
    );

    // a colour hadn't been called yet and the white didn't hit one: which were they going for?
    if (s.phase === "colour" && !s.called && shot.first && !COLOURS.includes(shot.first)) {
      parts.push(
        h("h3", { text: "Which colour were you going for?" }),
        h(
          "div",
          { class: "chips" },
          COLOURS.map((c) => chip(cap(c), shot.called === c, set(() => (shot.called = shot.called === c ? null : c)), { ball: c })),
          chip("Hadn't said", !shot.called, set(() => (shot.called = null)))
        )
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

    // the ruling
    if (!shot.first) {
      parts.push(h("div", { class: "verdict" }, h("p", { text: "Pick what the white hit first." })));
    } else {
      const r = judgeShot(s, { first: shot.first, reds: shot.reds, colours: [...shot.colours], white: shot.white, other: shot.other, called: shot.called });
      const go = (label, cls) =>
        btn(label, () => {
          closeSheet();
          for (const e of r.events) dispatch(e);
        }, `btn big ${cls}`);
      if (r.result === "pot") {
        parts.push(h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `Fair pot: +${r.pts} to ${me}` }), go(`Add ${r.pts} to ${me}`, "primary")));
      } else if (r.result === "miss") {
        parts.push(h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: "Not a foul" }), h("p", { text: `${r.reasons[0]} ${opp}'s turn.` }), go(`Missed: ${opp}'s turn`, "")));
      } else {
        const after = [];
        if (shot.white) after.push(`${opp} puts the white anywhere in the D`);
        else after.push(`${opp} plays from where the white stopped (not ball in hand)`);
        if (shot.reds) after.push(`${shot.reds === 1 ? "the red stays" : "the reds stay"} down`);
        if (shot.colours.size) after.push(`the ${[...shot.colours].join(" and ")} go${shot.colours.size === 1 ? "es" : ""} back on ${shot.colours.size === 1 ? "its spot" : "their spots"}`);
        parts.push(
          h(
            "div",
            { class: "verdict foul" },
            h("p", { class: "v-title", text: `Foul: ${r.pen} points to ${opp}` }),
            h("ul", { class: "reasons" }, r.reasons.map((x) => h("li", { text: x }))),
            h("p", { text: `Worth ${r.pen} because ${r.why}. Then ${after.join(", ")}.` }),
            go(`Give ${r.pen} to ${opp}`, "warn")
          )
        );
      }
    }
    body.replaceChildren(...parts);
  };
  draw();
  openSheet("What happened?", body);
}

function pictureSheet(title, text, opts) {
  openSheet(title, h("p", { class: "lead-text", text }), h("div", { class: "table-wrap", html: tableSVG(opts) }));
}

/* ---------------- menu ---------------- */

function menuSheet() {
  const s = state();
  const n = names();
  const items = [];
  const other = mode === "online" && online.seat !== null ? n[1 - online.seat] : null;
  if (mode === "online") {
    items.push(h("p", { class: "lead-text", text: online.seat === null ? "You're watching. Only the two sides can score." : `You're ${n[online.seat]}. You score your own turns; the other phone scores theirs.` }));
    items.push(h("div", { class: "share-link", text: shareUrl() }), btn("Share game link", shareLink, "btn"));
  }
  if (!s.over && (mode === "local" || can("concede", s))) {
    if (mode === "local")
      items.push(
        h("h3", { text: "Give up this game (concede)" }),
        h(
          "div",
          { class: "row" },
          [0, 1].map((p) =>
            btn(`${n[p]} concedes`, () => {
              closeSheet();
              dispatch({ t: "concede", who: p });
            })
          )
        )
      );
    else
      items.push(
        btn("Give up this game (concede)", () => {
          closeSheet();
          dispatch({ t: "concede", who: online.seat });
        })
      );
  }

  items.push(h("h3", { text: "Restart or reset" }));
  if (mode === "local") {
    items.push(
      btn("Restart this game", () =>
        confirmSheet("Restart this game?", "Both scores for this game go back to 0 and it starts again from the break. Earlier games are kept.", "Restart game", () => {
          eventsNow().length = 0;
          ui.setupDone.clear(); // the balls need setting up again
          saveLocal();
          render();
        })
      ),
      btn("Start the match over", () =>
        confirmSheet("Start the match over?", "Every game is cleared and games won go back to 0–0. Same players, same reds.", "Start over", () => {
          match = { ...match, frames: [{ breaker: match.frames[0].breaker, events: [] }] };
          ui.setupDone.clear();
          saveLocal();
          render();
        })
      ),
      btn("Delete this match", () =>
        confirmSheet("Delete this match?", "Every game and score on this phone goes, and you're back at the start.", "Delete", () => {
          deleteLocal();
          goHome();
        }), "btn warn")
    );
  } else if (online.seat !== null && other) {
    items.push(
      h("p", { class: "note", text: `Restarting wipes ${other}'s score too, so ${other} has to agree on their phone.` }),
      btn(`Restart this game (asks ${other})`, () => {
        closeSheet();
        dispatch({ t: "restart" });
        toast(`Asked ${other} to agree`);
      }),
      btn(`Start the match over (asks ${other})`, () => {
        closeSheet();
        dispatch({ t: "restart", all: true });
        toast(`Asked ${other} to agree`);
      })
    );
  }
  items.push(
    isPool()
      ? btn("How to rack the balls", () => openSheet("Racking the balls", h("div", { class: "table-wrap", html: poolSVG({ rack: true }) }), h("p", { class: "lead-text", text: "Triangle's tip on the foot spot at the far end. The 8 in the middle of the third row, a solid and a stripe in the back corners, the rest in any order. White anywhere behind the line at your end." })))
      : btn("Where the balls go at the start", () => openSheet("Setting up the table", h("div", { class: "table-wrap", html: setupSVG(match.reds) }), h("p", { class: "lead-text", text: "From the end with the D: green left, brown middle, yellow right. Blue in the middle of the table, pink halfway to the far end with the reds packed behind it, black near the far cushion. White anywhere in the D." })))
  );
  items.push(btn(isPool() ? "How pool works (1 minute)" : "How snooker works (1 minute)", () => learnSheet(0)));
  items.push(btn("Rules & quick answers", () => askSheet()));
  const light = document.documentElement.dataset.theme === "light";
  items.push(btn(light ? "Switch to dark theme" : "Switch to light theme", () => {
    setTheme(!light);
    closeSheet();
  }));
  if (installWay()) items.push(btn(installPlace === "home" ? "Add to home screen" : "Install the app", installSheet));
  if (mode === "local")
    items.push(
      btn("New game", () => {
        closeSheet();
        goHome();
      }, "btn ghost")
    );
  else
    items.push(
      btn("Leave this game", () => {
        closeSheet();
        goHome();
      }, "btn ghost"),
      online.seat !== null
        ? btn("Remove it from this phone", () =>
            confirmSheet("Remove this shared game?", "It's taken off this phone and you lose your seat in it. The other side keeps their copy.", "Remove", () => {
              forgetSeat(online.id);
              goHome();
            }), "btn ghost")
        : null
    );
  openSheet(mode === "online" ? "Shared game" : "Game", ...items.filter(Boolean));
}

/** Are you sure? — for anything that wipes scores. */
function confirmSheet(title, text, yes, onYes) {
  openSheet(
    title,
    h("p", { class: "lead-text", text }),
    h(
      "div",
      { class: "row" },
      btn(yes, () => {
        closeSheet();
        onYes();
      }, "btn warn big"),
      btn("Keep it", closeSheet, "btn big")
    )
  );
}

/* ---------------- ask ---------------- */

function askSheet(q = "") {
  const s = match ? state() : null;
  const { context, search, suggestions, byId, QA, TOPICS } = rulebook();
  const c = context(s, names());
  const input = h("input", { class: "ask-input", type: "search", placeholder: rulebook() === POOLQ ? "e.g. what if I scratch on the 8?" : "e.g. what if I pot the white?", "aria-label": "Ask a rules question", enterkeyhint: "search", value: q });
  const out = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const qa = (e, open = false) => {
    let answer;
    try {
      answer = e.a(c);
    } catch {
      answer = e.a(context(null));
    }
    const ans = h("div", { class: "ans" }, rich(answer));
    if (e.show === "table") ans.append(h("div", { class: "table-wrap", html: tableSVG({ rack: match ? match.reds : 15 }) }));
    if (e.show === "d") ans.append(h("div", { class: "table-wrap", html: tableSVG({ d: true }) }));
    if (["rack", "kitchen", "anywhere", "spot"].includes(e.show)) ans.append(h("div", { class: "table-wrap", html: poolSVG({ [e.show]: true }) }));
    const d = h("details", { class: "qa" }, h("summary", { text: e.q }), ans);
    d.open = open;
    return d;
  };
  const browse = () => {
    const now = suggestions(s).map(byId).filter(Boolean);
    out.replaceChildren(
      h("p", { class: "topic", text: s ? "Right now" : "Most asked" }),
      ...now.map((e) => qa(e)),
      ...TOPICS.flatMap((t) => [h("p", { class: "topic", text: t }), ...QA.filter((e) => e.topic === t && !now.includes(e)).map((e) => qa(e))])
    );
  };
  const find = () => {
    const text = input.value.trim();
    if (!text) return browse();
    const hits = search(text);
    out.replaceChildren(
      ...(hits.length
        ? hits.map((e, i) => qa(e, i === 0))
        : [h("p", { class: "note", text: rulebook() === POOLQ ? "No match. Try words like scratch, foul, break, 8, open table, call or ball in hand." : "No match. Try words like white, foul, call, free ball, spot, order or miss." })]),
      h("p", { class: "topic", text: "Or browse" }),
      ...suggestions(s).map(byId).filter((e) => e && !hits.includes(e)).map((e) => qa(e))
    );
  };
  input.addEventListener("input", find);
  const forWho = s && !s.over && !s.toss ? h("p", { class: "note", text: `Worked out for ${c.me}, at the table now: "I" means ${c.me}.` }) : null;
  openSheet("Quick answers", input, forWho, out);
  find();
}

/* ---------------- install ---------------- */

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;

function installSheet() {
  const way = installWay();
  const onHome = installPlace === "home";
  const b = (text) => h("b", { text });
  const steps = (...items) => h("ol", { class: "install-steps" }, items.map((parts) => h("li", {}, h("span", {}, ...parts))));
  let how = null;
  if (way === "prompt")
    how = btn(onHome ? "Add to home screen" : "Install", async () => {
      closeSheet();
      if (await promptInstall()) toast(onHome ? "Chalk is on your home screen" : "Chalk is installed");
    }, "btn primary big");
  else if ((way === "ios" || way === "mac") && appleGuide) how = appleSteps(appleGuide);
  else if (way === "ios") how = steps(["Open your browser's ", b("Share"), " menu ", h("span", { html: SHARE_ICON }), "."], ["Choose ", b("Add to Home Screen"), "."]);
  else if (way === "android") how = steps(["Open your browser's menu ", b("⋮"), "."], ["Choose ", b("Add to Home screen"), " or ", b("Install app"), "."]);
  else if (way === "chrome") how = steps(["Open Chrome's menu ", b("⋮"), " and choose ", b("Cast, save, and share"), "."], ["Choose ", b("Install page as app"), "."]);
  else if (way === "edge") how = steps(["Open Edge's menu ", b("…"), " and choose ", b("Apps"), "."], ["Choose ", b("Install this site as an app"), "."]);
  openSheet(
    onHome ? "Keep it on your home screen" : "Install the app",
    h("p", { class: "lead-text", text: "It opens full-screen like an app and keeps the screen awake while you play. No app store, nothing to update." }),
    how || h("p", { class: "note", text: "This browser can't add it. Try Safari on iPhone or Chrome on Android." })
  );
}

function appleSteps(kind) {
  const b = (text) => h("b", { text });
  const here = location.origin + location.pathname;
  if (kind === "open-safari")
    return h(
      "div",
      { style: "display:flex;flex-direction:column;gap:10px" },
      h("p", { class: "lead-text", text: canOpenSafari ? "In-app browsers can't add to the home screen. Open this page in Safari, then add it from there." : "Only Safari can add it from here. Copy the link, open Safari and paste it in." }),
      canOpenSafari ? h("a", { class: "btn primary", href: `x-safari-${here}`, rel: "noopener" }, "Open in Safari") : null,
      btn("Copy link", async () => {
        try {
          await navigator.clipboard.writeText(here);
          toast("Link copied. Now open Safari and paste it in.");
        } catch {
          toast("Couldn't copy. Long-press the address bar instead.");
        }
      })
    );
  const text = {
    firefox: [["Tap the menu ", b("☰"), " at the bottom right."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    edge: [["Tap ", b("•••"), " at the bottom of the screen."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    other: [["Open your browser's ", b("Share"), " menu."], ["Choose ", b("Add to Home Screen"), "."]],
  }[kind];
  if (text) return h("ol", { class: "install-steps" }, text.map((t) => h("li", {}, h("span", {}, ...t))));
  const addHome = ["Scroll down and choose ", b("Add to Home Screen"), "."];
  const captions = {
    safari: [["Tap ", b("Share"), " in the toolbar."], addHome],
    safari26: [["Tap ", b("•••"), ", then ", b("Share"), "."], addHome],
    ipad: [["Tap ", b("Share"), " at the top right."], addHome],
    chrome: [["Tap ", b("Share"), " in the address bar."], addHome],
    mac: [["In the menu bar, open ", b("File"), "."], ["Choose ", b("Add to Dock"), "."]],
  }[kind];
  return h(
    "ol",
    { class: "guide-pics" },
    guideArt[kind].map((art, i) => h("li", {}, h("span", { class: "guide-art", html: art }), h("span", { class: "guide-cap" }, ...captions[i])))
  );
}

function syncInstall() {
  for (const el of document.querySelectorAll(".install-link")) el.hidden = !installWay();
}
onInstallChange(syncInstall);

/* ---------------- keep the screen on while playing ---------------- */

let lock = null;
async function wake(on) {
  try {
    if (on && !lock && "wakeLock" in navigator && document.visibilityState === "visible") {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

$(".pool-art").replaceChildren(...[1, 11, 8, 6, 13].map((n) => pool.pdot(n, "pdot big")));
for (const b of document.querySelectorAll("#view-pick [data-game]"))
  b.addEventListener("click", () => {
    pickGame(b.dataset.game);
    renderHome();
    show("home");
  });
$("#game-pick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-game]");
  if (!b) return;
  pickGame(b.dataset.game);
  renderHome();
});
$("#reds-pick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-reds]");
  if (!b) return;
  ui.redsPick = +b.dataset.reds;
  for (const x of $("#reds-pick").children) x.setAttribute("aria-checked", String(x === b));
});
$("#break-pick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-b]");
  if (!b) return;
  ui.breakPick = b.dataset.b;
  syncBreakPick();
});
$("#local-form").addEventListener("input", syncBreakPick);
$("#local-form").addEventListener("submit", startLocal);
$("#start-local").addEventListener("click", openLocalSetup);
$("#start-online").addEventListener("click", startOnline);
$("#btn-miss").addEventListener("click", () => {
  if (!can("turn")) return;
  if (isPool()) return pool.missed();
  dispatch({ t: "miss" });
});
$("#btn-foul").addEventListener("click", () => {
  if (!can("turn")) return;
  if (!isPool()) return shotSheet();
  if (state().breakShot) pool.breakSheet();
  else pool.shotSheet();
});
$("#btn-undo").addEventListener("click", () => dispatch({ t: "undo" }));
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go && go.dataset.go === "home") return goHome();
  const open = e.target.closest("[data-open]");
  if (!open) return;
  if (open.dataset.open === "ask") askSheet();
  if (open.dataset.open === "menu") menuSheet();
  if (open.dataset.open === "install") installSheet();
  if (open.dataset.open === "learn") learnSheet(0);
});

function boot() {
  syncInstall();
  try {
    const g = localStorage.getItem(GAME);
    ui.game = g === "pool" || g === "snooker" ? g : null;
  } catch {}
  const id = new URLSearchParams(location.search).get("g");
  if (id && /^[a-z2-9]{10}$/.test(id)) return openOnline(id);
  stopPolling();
  mode = null;
  if (!ui.game) {
    // first start: snooker or pool? (old snooker users already have a saved game: keep them on it)
    if (loadLocal("snooker") || Object.keys(seats()).length) pickGame("snooker");
    else return show("pick");
  }
  renderHome();
  show("home");
}
window.addEventListener("popstate", boot);
boot();

// Offline after the first visit (club basements rarely have signal). Not on localhost, so edits show up.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
