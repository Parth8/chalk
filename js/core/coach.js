// A first-game walkthrough: a ring around one part of the screen at a time, with a short note.
// steps = [{ target: "#players", title, text }]; parts that aren't on screen are skipped.

import { $, h, btn } from "./dom.js";

let active = null;

export const touring = () => !!active;

export function startTour(steps, onEnd = () => {}) {
  endTour();
  const list = steps.filter((s) => $(s.target) && $(s.target).getClientRects().length);
  if (!list.length) return onEnd();
  const ring = h("div", { class: "coach-ring", "aria-hidden": "true" });
  const bubble = h("div", { class: "coach-bubble", role: "dialog", "aria-live": "polite", "aria-label": "Walkthrough" });
  const root = h("div", { class: "coach", id: "coach" }, ring, bubble);
  document.body.append(root);
  active = { root, i: 0, place: null, onEnd };

  const show = (i) => {
    active.i = i;
    const step = list[i];
    const el = $(step.target);
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const last = i === list.length - 1;
    bubble.replaceChildren(
      h("p", { class: "coach-count", text: `${i + 1} of ${list.length}` }),
      h("p", { class: "coach-title", text: step.title }),
      h("p", { class: "coach-text", text: step.text }),
      h("div", { class: "row" }, last ? null : btn("Skip", endTour, "btn ghost"), btn(last ? "Let's play" : "Next", () => (last ? endTour() : show(i + 1)), "btn primary"))
    );
    active.place = () => place(el, ring, bubble);
    setTimeout(active.place, 320); // after the scroll settles
    active.place();
    bubble.querySelector(".btn.primary").focus({ preventScroll: true });
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, { passive: true });
  show(0);
}

function reposition() {
  active?.place?.();
}

function place(el, ring, bubble) {
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const below = r.bottom + 16;
  const room = window.innerHeight - below;
  bubble.style.top = room > bubble.offsetHeight + 12 ? `${below}px` : `${Math.max(12, r.top - bubble.offsetHeight - 16)}px`;
}

export function endTour() {
  if (!active) return;
  const { root, onEnd } = active;
  active = null;
  root.remove();
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition);
  onEnd();
}

document.addEventListener("keydown", (e) => e.key === "Escape" && endTour());
