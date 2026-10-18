// A shared game before it starts: the lobby (waiting for the other side, with the link and a QR
// code) or the join form (your name, and your partner's for doubles). Also what shows when a
// link doesn't open.

import { $, h, btn, toast } from "../core/dom.js";
import { session } from "../core/session.js";
import { targetWords } from "../core/match.js";
import * as sync from "../core/sync.js";
import * as store from "../core/store.js";
import { GAMES } from "../games.js";
import { linkBlock } from "./share.js";

const card = () => $("#join-card");

/** "8-ball pool, best of 5" / "Snooker, 15 reds" */
function gameWords(g) {
  const bits = [g.kind === "pool" ? GAMES.pool.label : `${GAMES.snooker.label}, ${g.reds} reds`, targetWords(g.target)];
  return bits.filter(Boolean).join(", ");
}

export const renderLoading = () => card().replaceChildren(h("p", { class: "note", text: "Loading the game…" }));

export function renderJoin() {
  const g = sync.online.game;
  if (!g) return renderLoading();
  const seatsRow = h(
    "div",
    { class: "seats" },
    g.players.map((n, i) => h("div", { class: `seat${n ? "" : " open"}` }, h("small", { text: session.seat === i ? "You" : `Side ${i + 1}` }), h("b", { text: n || "Open" })))
  );
  if (session.seat !== null) {
    card().replaceChildren(
      h("h2", {}, h("span", { class: "pulse-dot", "aria-hidden": "true" }), "Waiting for the other side"),
      h("p", { class: "note", text: `${gameWords(g)}. Your opponent opens the link, types their name, and a coin toss decides who breaks.` }),
      seatsRow,
      linkBlock()
    );
    return;
  }
  const invited = g.players.some(Boolean);
  card().replaceChildren(
    h("h2", { text: invited ? `${g.players.find(Boolean)} invited you` : "Your shared game" }),
    h(
      "p",
      { class: "note", text: invited ? `${gameWords(g)}. Type your name and you're in. Each side scores their own turns; everyone sees everything.` : `${gameWords(g)}. Type your name (or your team's), then send the link or QR code to the other side.` }
    ),
    invited ? seatsRow : null,
    joinForm(invited ? "Join and play" : "Get the link")
  );
}

function joinForm(label) {
  const last = store.read(store.KEYS.names, []);
  const name = h("input", { name: "name", maxlength: "24", placeholder: "e.g. Parth, or Team Pink", autocomplete: "nickname", enterkeyhint: "go", required: true, value: (Array.isArray(last) && last[0]) || "" });
  const partner = h("input", { name: "partner", maxlength: "24", placeholder: "Your partner's name", autocomplete: "off", enterkeyhint: "go" });
  const doubles = h("details", { class: "more" }, h("summary", { text: "Playing doubles? Add your partner" }), h("label", { class: "field" }, h("span", { text: "Partner" }), partner));
  const go = h("button", { type: "submit", class: "btn primary big" }, h("span", { text: label }));
  const submit = async (e) => {
    e.preventDefault();
    const me = name.value.trim();
    const mate = partner.value.trim();
    if (!me) return name.focus();
    go.disabled = true;
    try {
      const side = mate ? [...`${me} & ${mate}`].slice(0, 24).join("") : me; // whole characters, never half an emoji
      const r = await sync.join(side, mate ? [me, mate] : null);
      store.write(store.KEYS.names, [me, ""]);
      if (r.game.frames.length) toast(`Coin toss: ${r.game.players[r.game.frames[0].breaker]} breaks`);
    } catch (err) {
      toast(err.message);
      go.disabled = false;
      if (err.code === "full") sync.refresh();
    }
  };
  return h("form", { class: "card-form", on: { submit } }, h("label", { class: "field" }, h("span", { text: "Your name or team" }), name), doubles, go);
}

/** The link didn't open: say why, and offer the way on. */
export function renderJoinError(err, retry, scoreHere) {
  card().replaceChildren(
    h("h2", { text: err.code === "no_game" ? "Game not found" : "Couldn't open the game" }),
    h("p", { class: "note", text: err.message }),
    retry && err.code !== "no_game" ? btn("Try again", retry, "btn") : null,
    btn("Score on this phone instead", scoreHere, "btn ghost")
  );
}
