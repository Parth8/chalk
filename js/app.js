// The page: views, the ball pad, guidance, the foul sheet, the re-spot helper, quick answers,
// and keeping a shared game in step. All the rules live in engine.js.

import { BALLS, COLOURS, VALUE, ballsOn, judgePot, penalty, replayFrame, framesWon, newMatch, nextFrame, standing } from "./engine.js";
import { QA, TOPICS, context, search, suggestions, byId } from "./rules.js";
import { tableSVG, spotOrder, SPOT_WORDS } from "./table.js";
import { api, seatFor, keepSeat, seats } from "./api.js";
import { installWay, installPlace, appleGuide, canOpenSafari, onInstallChange, promptInstall } from "./install.js";
import { guideArt } from "./guide.js";

const $ = (sel) => document.querySelector(sel);
const LOCAL = "snooker.local";
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
const online = { id: null, v: 0, seat: null, token: null, game: null, busy: false, timer: null, down: false };
const ui = { spotKey: "", spotStep: 0, spotFall: 0, foulDone: "", seen: new Set(), redsPick: 15, breakPick: "0", watch: null };

const state = () => replayFrame(match);
const names = () => (match ? match.players.map((n, i) => n || `Player ${i + 1}`) : ["Player 1", "Player 2"]);
const frameNo = () => match.frames.length;
const eventsNow = () => match.frames[match.frames.length - 1].events;
const evKey = () => `${frameNo()}:${eventsNow().length}`;

function can(what, s = state()) {
  const ev = eventsNow();
  const rules = {
    turn: !s.over && !s.toss,
    toss: s.toss,
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
  Object.assign(online, { id: null, v: 0, seat: null, token: null, game: null });
  if (location.search) history.pushState(null, "", location.pathname);
  renderHome();
  show("home");
}

function renderHome() {
  const resume = $("#resume");
  resume.replaceChildren();
  const saved = loadLocal();
  const parts = [];
  if (saved) {
    const s = replayFrame(saved);
    const n = saved.players;
    parts.push(
      btn(
        [h("span", { text: `Carry on: ${n[0]} v ${n[1]}` }), h("small", { text: `Frame ${saved.frames.length} · ${s.scores[0]}–${s.scores[1]}${s.over ? " · finished" : ""}` })],
        () => openLocal(saved),
        "btn big"
      )
    );
  }
  const recent = Object.entries(seats()).sort((a, b) => b[1].at - a[1].at)[0];
  if (recent && Date.now() - recent[1].at < 2 * 86400_000) {
    const [id, s] = recent;
    parts.push(
      btn([h("span", { text: "Back to your shared game" }), h("small", { text: (s.names || []).filter(Boolean).join(" v ") || id })], () => openOnline(id, true), "btn big")
    );
  }
  resume.hidden = !parts.length;
  resume.append(...parts);
  for (const b of $("#reds-pick").children) b.setAttribute("aria-checked", String(+b.dataset.reds === ui.redsPick));
}

/* ---------------- this phone ---------------- */

function loadLocal() {
  try {
    const m = JSON.parse(localStorage.getItem(LOCAL) || "null");
    if (!m || !Array.isArray(m.frames) || !m.frames.length) return null;
    replayFrame(m); // throws if damaged
    return m;
  } catch {
    return null;
  }
}
function saveLocal() {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(match));
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
  openLocal(newMatch({ players, reds: ui.redsPick, breaker }));
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
    const r = await api.create(ui.redsPick);
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
  Object.assign(online, { id, v: 0, game: null, seat: null, token: null });
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
  online.v = r.v;
  online.game = r.game;
  match = { players: r.game.players, reds: r.game.reds, frames: r.game.frames };
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
      await navigator.share({ title: "Snooker", text: "Join my snooker game:", url });
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
      h("p", { class: "note", text: `Send this link to your opponent. They open it, type their name, and the coin toss decides who breaks. ${g.reds} reds.` }),
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
    h("p", { class: "note", text: full ? "You can watch the score live." : `${g.reds} reds. Type your name and you're in. Each side scores their own turns; everyone sees everything.` }),
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
    else if (e.t === "next") match = nextFrame(match);
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
  // shared game: show it straight away, then let the Worker confirm
  const before = structuredClone(match);
  const v = online.v;
  if (e.t === "undo") eventsNow().pop();
  else if (e.t === "next") match = nextFrame(match);
  else eventsNow().push({ ...e, by: online.seat });
  render();
  online.busy = true;
  try {
    applyServer(await api.act(online.id, online.token, v, e));
  } catch (err) {
    match = before;
    if (err.data && err.data.game) applyServer(err.data);
    else render();
    toast(err.code === "stale" ? "The other phone just changed something. Have another look." : err.message);
  } finally {
    online.busy = false;
  }
}

function undoLocal() {
  const ev = eventsNow();
  if (ev.length) ev.pop();
  else if (match.frames.length > 1) match.frames.pop();
}

function onBall(ball) {
  const s = state();
  if (!can("turn", s)) return;
  const j = judgePot(s, ball);
  if (j.ok && j.extra) return twoRedsSheet();
  if (j.ok) return dispatch({ t: "pot", ball });
  if (j.reason !== "foul") return;
  const why =
    s.phase === "red"
      ? `You're on a red, so the ${ball} going in is a foul. (Any colour only counts as a red with a free ball, after a foul.)`
      : s.phase === "colour"
        ? `You're on a colour, so a red going in is a foul.`
        : `You're on the ${COLOURS[s.next]}. Potting the ${ball} now is a foul.`;
  foulSheet({ kind: "wrong-pot", ...(ball === "red" ? { reds: 1 } : { colours: [ball] }) }, why);
}

/* ------------------------------------------------------------------ */
/* Game screen                                                         */
/* ------------------------------------------------------------------ */

function render() {
  if (!match || !match.frames.length) return;
  const s = state();
  renderTag(s);
  renderPlayers(s);
  renderStanding(s);
  renderGuide(s);
  renderPad(s);
  renderActions(s);
  renderLog(s);
}

function renderTag(s = state()) {
  if (!match) return;
  const tag = $("#frame-tag");
  tag.replaceChildren("Frame ", h("b", { text: String(frameNo()) }), ` · ${match.reds} reds`);
  if (mode === "online") {
    tag.append(" · ", h("span", { class: "live", text: online.down ? "reconnecting…" : online.seat === null ? "watching live" : "live" }));
  }
}

function renderPlayers(s) {
  const n = names();
  const won = framesWon(match);
  const card = (p) =>
    h(
      "div",
      { class: `player${!s.over && !s.toss && s.turn === p ? " at" : ""}`, "aria-label": `${n[p]}: ${s.scores[p]}` },
      h("div", { class: "p-name" }, h("span", { text: n[p] }), mode === "online" && online.seat === p ? h("span", { class: "p-you", text: "YOU" }) : null),
      h("div", { class: "p-score", text: String(s.scores[p]) }),
      h("div", { class: "p-sub" }, ...(s.turn === p && s.brk > 0 && !s.over ? ["Break ", h("b", { text: String(s.brk) })] : s.best[p] ? [`Best break ${s.best[p]}`] : []))
    );
  $("#players").replaceChildren(card(0), h("div", { class: "frames" }, h("b", { text: `${won[0]}–${won[1]}` }), h("small", { text: "FRAMES" })), card(1));
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
        h("p", { class: "g-kicker", text: s.conceded !== null ? `${n[s.conceded]} conceded` : "Frame over" }),
        h("p", { class: "g-title", text: `${n[w]} wins ${Math.max(...s.scores)}–${Math.min(...s.scores)}` }),
        h("p", { class: "g-text", text: `Highest breaks: ${n[0]} ${s.best[0]}, ${n[1]} ${s.best[1]}.` }),
        can("next", s) ? h("div", { class: "row" }, btn(`Next frame · ${n[1 - match.frames[frameNo() - 1].breaker]} breaks`, () => dispatch({ t: "next" }), "btn primary")) : null
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
        h("p", { class: "g-title", text: `${s.foul.pen} to ${inc}` }),
        h("p", { class: "g-text" }, cap(s.foul.why), ". ", s.inHand ? h("b", { text: "White in hand: anywhere in the D." }) : "Play from where the white stopped."),
        mine
          ? h(
              "div",
              { class: "row" },
              btn("Play on", () => {
                ui.foulDone = evKey();
                render();
              }, "btn primary"),
              btn(`${off} plays again`, () => dispatch({ t: "again" })),
              btn("Free ball", () => freeBallSheet()),
              btn("Miss: put back", () => missSheet(off))
            )
          : h("p", { class: "g-text", text: `${inc} decides: play on, make ${off} play again, or take a free ball if snookered.` })
      )
    );
  }

  const spot = spotCard(s);
  if (spot) alerts.push(spot);

  if (!s.over && !s.toss) {
    const on = onColour(s);
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
      text = breakOff ? "White anywhere in the D. Hit a red first." : `${s.reds} red${s.reds === 1 ? "" : "s"} left. Then a colour of your choice.`;
    } else if (s.phase === "colour") {
      title = "Now any colour";
      text = s.reds > 0 ? "Call it, then pot it. It goes back on its spot, then it's reds again." : "That was the last red: one colour of your choice, then yellow to black in order.";
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
    if (s.inHand && !s.foul && eventsNow().length)
      card.append(h("p", { class: "g-text" }, h("b", { text: "White in hand: " }), "place it anywhere in the D. ", btn("Show me", () => pictureSheet("White in hand", "Anywhere inside the D, or on its lines. You can play in any direction.", { d: true }), "link")));
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
  if (all) text = `Every spot is covered: place it as close to its own spot as you can, towards the top cushion${ball === "pink" || ball === "black" ? " (if that's blocked, straight below its spot)" : ""}, not touching another ball.`;
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
  pad.replaceChildren(
    ...BALLS.map((b) => {
      const isOn = on.includes(b);
      const free = s.free && isOn && b !== "red" && !(s.phase === "clear" && b === COLOURS[s.next]);
      const disabled = !turn || (b === "red" && s.reds === 0);
      const label = b === "red" ? `Red, ${s.reds} left` : `${cap(b)}, ${VALUE[b]}`;
      return h(
        "button",
        {
          type: "button",
          class: `ball ${b === "red" ? "red" : ""} ${isOn ? "on" : "off"}`,
          "data-ball": b,
          "aria-label": `${label}${isOn ? "" : " (not on)"}`,
          disabled,
          on: { click: () => onBall(b) },
        },
        b === "red" ? (s.reds ? ["Red", h("span", { class: "count", text: `× ${s.reds}` })] : "No reds left") : String(VALUE[b]),
        free ? h("span", { class: "tag", text: "FREE" }) : null
      );
    })
  );
}

function renderActions(s) {
  const turn = can("turn", s);
  $("#btn-miss").disabled = !turn;
  $("#btn-foul").disabled = !turn;
  $("#btn-undo").disabled = !can("undo", s);
  const last = eventsNow()[eventsNow().length - 1];
  $("#undo-sub").textContent = !last ? (match.frames.length > 1 ? "new frame" : "last tap") : last.t === "pot" ? `the ${last.ball}` : { miss: "the miss", foul: "the foul", again: "play again", replace: "put back", free: "free ball", toss: "the toss", concede: "concede" }[last.t] || "last tap";
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
function openSheet(title, ...body) {
  lastFocus = document.activeElement;
  const head = h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title", text: title }), btn("✕", closeSheet, "icon-btn close", { "aria-label": "Close" }));
  $("#sheet-body").replaceChildren(head, ...body);
  $("#sheet").hidden = false;
  $("#scrim").hidden = false;
  $("#sheet-body").scrollTop = 0;
  head.querySelector("button").focus({ preventScroll: true });
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  lastFocus?.focus?.({ preventScroll: true });
}
$("#scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#sheet").hidden && closeSheet());

function twoRedsSheet() {
  openSheet(
    "Another red?",
    h("p", { class: "lead-text", text: "Did two reds go in on the same shot? Both count, a point each." }),
    h(
      "div",
      { class: "row" },
      btn("Yes, same shot (+1)", () => {
        closeSheet();
        dispatch({ t: "pot", ball: "red", extra: true });
      }, "btn primary big"),
      btn("No, a new shot", () => {
        closeSheet();
        foulSheet({ kind: "seven", reds: 1 }, "After a red you must play a colour. Playing at a red instead is a 7-point foul.");
      }, "btn big")
    )
  );
}

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

const FOULS = [
  ["white", "Potted the white", "In-off, or it left the table"],
  ["nothing", "Hit nothing", "Missed every ball"],
  ["wrong-first", "Hit the wrong ball first", "e.g. a red when you'd called a colour"],
  ["wrong-pot", "Potted a ball that wasn't on", "Add it below"],
  ["off", "Knocked a ball off the table", "Add it below"],
  ["touch", "Touched a ball, push or jump", "Hand, cue or clothes · double hit · feet off the floor"],
  ["seven", "A 7-point foul", "Reds twice in a row · used a ball to measure"],
];

function foulSheet(prefill = {}, why = "") {
  const s = state();
  const n = names();
  const off = n[s.turn];
  const opp = n[1 - s.turn];
  const f = { kind: prefill.kind || null, hit: prefill.hit || null, reds: prefill.reds || 0, colours: new Set(prefill.colours || []), white: prefill.kind === "white", called: null };
  const body = h("div", { class: "choices-wrap", style: "display:flex;flex-direction:column;gap:14px" });

  const chip = (ball, pressed, onClick, extra) =>
    h("button", { type: "button", class: "chip ball-chip", "aria-pressed": String(pressed), on: { click: onClick } }, dot(ball), cap(ball), extra);

  const draw = () => {
    const sections = [];
    if (why) sections.push(h("p", { class: "explain", text: why }));
    sections.push(
      h("h3", { text: "What happened?" }),
      h(
        "div",
        { class: "choices" },
        FOULS.map(([k, label, sub]) =>
          h(
            "button",
            {
              type: "button",
              class: "choice",
              "aria-pressed": String(f.kind === k),
              on: {
                click: () => {
                  f.kind = k;
                  if (k === "white") f.white = true;
                  draw();
                },
              },
            },
            label,
            h("small", { text: sub })
          )
        )
      )
    );
    if (f.kind === "wrong-first" || f.kind === "touch") {
      sections.push(
        h("h3", { text: f.kind === "touch" ? "Which ball? (if one was touched)" : "Which ball did the white hit first?" }),
        h(
          "div",
          { class: "chips" },
          BALLS.map((b) =>
            chip(b, f.hit === b, () => {
              f.hit = f.hit === b ? null : b;
              draw();
            })
          )
        )
      );
    }
    if (f.kind !== "seven") {
      const reds = Math.min(s.reds, 15);
      sections.push(
        h("h3", { text: "Potted or off the table on this shot" }),
        h(
          "div",
          { class: "chips" },
          h(
            "button",
            {
              type: "button",
              class: "chip ball-chip",
              "aria-pressed": String(f.white),
              on: {
                click: () => {
                  f.white = !f.white;
                  draw();
                },
              },
            },
            dot("white"),
            "White"
          ),
          reds
            ? h(
                "span",
                { class: "chip ball-chip", "aria-pressed": String(f.reds > 0) },
                dot("red"),
                `Red × ${f.reds}`,
                h(
                  "span",
                  { class: "stepper" },
                  btn("−", () => {
                    f.reds = Math.max(0, f.reds - 1);
                    draw();
                  }, "", { "aria-label": "One red fewer" }),
                  btn("+", () => {
                    f.reds = Math.min(reds, f.reds + 1);
                    draw();
                  }, "", { "aria-label": "One more red" })
                )
              )
            : null,
          COLOURS.map((c) =>
            chip(c, f.colours.has(c), () => {
              f.colours.has(c) ? f.colours.delete(c) : f.colours.add(c);
              draw();
            })
          )
        )
      );
    }
    if (s.phase === "colour" && f.kind !== "seven") {
      sections.push(
        h("h3", { text: "Which colour had you called?" }),
        h(
          "div",
          { class: "chips" },
          COLOURS.map((c) =>
            chip(c, f.called === c, () => {
              f.called = f.called === c ? null : c;
              draw();
            })
          )
        ),
        f.called ? null : h("p", { class: "note", text: "Not called? The rules make a foul before calling a colour worth 7." })
      );
    }
    const ev = { kind: f.kind || "other", hit: f.hit || undefined, reds: f.reds || undefined, colours: f.colours.size ? [...f.colours] : undefined, white: f.white || undefined, called: f.called || undefined };
    const { pen, why: reason } = penalty(s, ev);
    const after = [];
    if (f.white) after.push(`${opp} gets the white in hand in the D`);
    if (f.reds) after.push(`${f.reds === 1 ? "the red stays" : "the reds stay"} down`);
    if (f.colours.size) after.push(`${[...f.colours].join(" and ")} go${f.colours.size === 1 ? "es" : ""} back on ${f.colours.size === 1 ? "its spot" : "their spots"}`);
    sections.push(
      h(
        "div",
        { class: "verdict" },
        h("p", { text: `${cap(reason)}.${after.length ? ` Then ${after.join(", ")}.` : ""}` }),
        btn(`Give ${pen} to ${opp}`, () => {
          closeSheet();
          dispatch({ t: "foul", ...Object.fromEntries(Object.entries(ev).filter(([, v]) => v !== undefined)) });
        }, "btn warn big", { disabled: !f.kind })
      )
    );
    body.replaceChildren(...sections);
  };
  draw();
  openSheet(`Foul by ${off}`, body);
}

function pictureSheet(title, text, opts) {
  openSheet(title, h("p", { class: "lead-text", text }), h("div", { class: "table-wrap", html: tableSVG(opts) }));
}

/* ---------------- menu ---------------- */

function menuSheet() {
  const s = state();
  const n = names();
  const items = [];
  if (mode === "online") {
    items.push(h("p", { class: "lead-text", text: online.seat === null ? "You're watching. Only the two sides can score." : `You're ${n[online.seat]}. You score your own turns; the other phone scores theirs.` }));
    items.push(h("div", { class: "share-link", text: shareUrl() }), btn("Share game link", shareLink, "btn"));
  }
  if (!s.over && (mode === "local" || can("concede", s))) {
    if (mode === "local")
      items.push(
        h("h3", { text: "Concede this frame" }),
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
        btn("Concede this frame", () => {
          closeSheet();
          dispatch({ t: "concede", who: online.seat });
        })
      );
  }
  if (mode === "local" && eventsNow().length && !s.over)
    items.push(
      btn("Re-rack this frame (stalemate)", () => {
        if (!confirm("Start this frame again from the break? Its scores are cleared.")) return;
        closeSheet();
        eventsNow().length = 0;
        saveLocal();
        render();
      })
    );
  items.push(
    btn("Where the balls go", () => pictureSheet("Setting up", "Standing at the baulk end: green left, brown middle, yellow right. Blue in the middle, pink below the reds, black at the top.", { rack: match.reds }))
  );
  items.push(btn("Rules & quick answers", () => askSheet()));
  if (installWay()) items.push(btn(installPlace === "home" ? "Add to home screen" : "Install the app", installSheet));
  items.push(
    btn(mode === "local" ? "New game" : "Leave this game", () => {
      closeSheet();
      goHome();
    }, "btn ghost")
  );
  openSheet(mode === "online" ? "Shared game" : "Game", ...items);
}

/* ---------------- ask ---------------- */

function askSheet(q = "") {
  const s = match ? state() : null;
  const c = context(s, names());
  const input = h("input", { class: "ask-input", type: "search", placeholder: "e.g. what if I pot the white?", "aria-label": "Ask a rules question", enterkeyhint: "search", value: q });
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
        : [h("p", { class: "note", text: "No match. Try words like white, foul, call, free ball, spot, order or miss." })]),
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
      if (await promptInstall()) toast(onHome ? "Snooker is on your home screen" : "Snooker is installed");
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
$("#btn-miss").addEventListener("click", () => can("turn") && dispatch({ t: "miss" }));
$("#btn-foul").addEventListener("click", () => can("turn") && foulSheet());
$("#btn-undo").addEventListener("click", () => dispatch({ t: "undo" }));
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go && go.dataset.go === "home") return goHome();
  const open = e.target.closest("[data-open]");
  if (!open) return;
  if (open.dataset.open === "ask") askSheet();
  if (open.dataset.open === "menu") menuSheet();
  if (open.dataset.open === "install") installSheet();
});

function boot() {
  syncInstall();
  const id = new URLSearchParams(location.search).get("g");
  if (id && /^[a-z2-9]{10}$/.test(id)) return openOnline(id);
  stopPolling();
  mode = null;
  renderHome();
  show("home");
}
window.addEventListener("popstate", boot);
boot();

// Offline after the first visit (club basements rarely have signal). Not on localhost, so edits show up.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
