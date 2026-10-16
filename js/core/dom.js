// A tiny DOM builder and the few page-wide helpers everything uses.
// Text is always set as text; `html` is only ever used for our own static SVG.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...kids) {
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

export const btn = (label, onClick, cls = "btn", attrs = {}) => h("button", { type: "button", class: cls, on: { click: onClick }, ...attrs }, label);

export const cap = (w) => w[0].toUpperCase() + w.slice(1);

/** **bold**, "• " bullet lines and paragraphs, from text that may contain player names. */
export function rich(text) {
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
export function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/** Only cards that just appeared slide in; the rest stay still while you tap. */
const seen = { keys: new Set() };
export function markNew(root = document) {
  const keys = new Set();
  for (const c of root.querySelectorAll(".g-card[data-key]")) {
    keys.add(c.dataset.key);
    if (!seen.keys.has(c.dataset.key)) c.classList.add("new");
  }
  seen.keys = keys;
}

/** A guide card with a small picture beside its words (a table with a spot marked, the D…). */
export function cardWithPicture(card, svg) {
  card.classList.add("spot");
  const copy = h("div", { class: "spot-copy" }, ...card.childNodes);
  card.replaceChildren(copy, h("span", { class: "card-pic", html: svg }));
  return card;
}
