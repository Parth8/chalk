// Quick answers: search the rules of the game being played, worked out for the moment you're in
// ("I" is whoever is at the table). Each game brings its own questions and pictures.

import { h, rich } from "../core/dom.js";
import { openSheet } from "../core/sheet.js";
import { session, state, names } from "../core/session.js";
import { gameUI } from "../games.js";

export function askSheet(q = "") {
  const ui = gameUI();
  const { context, search, suggestions, byId, QA, TOPICS } = ui.rules;
  const s = session.match ? state() : null;
  const c = context(s, session.match ? names() : undefined);
  const input = h("input", { class: "ask-input", type: "search", placeholder: ui.ask.placeholder, "aria-label": "Ask a rules question", enterkeyhint: "search", value: q });
  const out = h("div", { class: "qa-list" });

  const qa = (e, open = false) => {
    let answer;
    try {
      answer = e.a(c);
    } catch {
      answer = e.a(context(null));
    }
    const ans = h("div", { class: "ans" }, rich(answer));
    const pic = e.show && ui.ask.picture(e.show, session.match);
    if (pic) ans.append(h("div", { class: "table-wrap", html: pic }));
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
      ...(hits.length ? hits.map((e, i) => qa(e, i === 0)) : [h("p", { class: "note", text: ui.ask.noMatch })]),
      h("p", { class: "topic", text: "Or browse" }),
      ...suggestions(s)
        .map(byId)
        .filter((e) => e && !hits.includes(e))
        .map((e) => qa(e))
    );
  };
  input.addEventListener("input", find);
  const forWho = s && !c.generic && !s.over && !s.toss ? h("p", { class: "note", text: `Worked out for ${c.me}, at the table now: "I" means ${c.me}.` }) : null;
  openSheet("Quick answers", input, forWho, out);
  find();
}

/** One answer on its own, e.g. "what's a frame?" from the header. */
export function answerSheet(id) {
  const { byId, context } = gameUI().rules;
  const e = byId(id);
  openSheet(e.q, h("div", { class: "qa-solo" }, rich(e.a(context(session.match ? state() : null, session.match ? names() : undefined)))));
}
