// The bottom sheet: one at a time, opened with a title and content.
// A "locked" sheet is a step that must be finished at the table (set up the table, put a ball
// back): it has no ✕ and tapping outside doesn't close it.

import { $, h, btn } from "./dom.js";

export const sheet = { kind: null, locked: false };
let lastFocus = null;

/** openSheet(title, [{ locked, kind }], ...content) */
export function openSheet(title, ...body) {
  const opts = body[0] && !(body[0] instanceof Node) && typeof body[0] === "object" && "locked" in body[0] ? body.shift() : {};
  if ($("#sheet").hidden) lastFocus = document.activeElement;
  sheet.locked = !!opts.locked;
  sheet.kind = opts.kind || null;
  const head = h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title", text: title }), opts.locked ? null : btn("✕", closeSheet, "icon-btn close", { "aria-label": "Close" }));
  $("#sheet-body").replaceChildren(head, ...body.filter(Boolean));
  $("#sheet").hidden = false;
  $("#scrim").hidden = false;
  $("#sheet-body").scrollTop = 0;
  ($("#sheet-body").querySelector("button") || head).focus?.({ preventScroll: true });
}

const closeListeners = new Set();
/** Run something whenever a sheet closes (the game screen re-checks what the table needs). */
export const onSheetClose = (fn) => closeListeners.add(fn);

export function closeSheet() {
  const wasOpen = isOpen();
  sheet.locked = false;
  sheet.kind = null;
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  lastFocus?.focus?.({ preventScroll: true });
  if (wasOpen) closeListeners.forEach((fn) => fn());
}

export const isOpen = () => !$("#sheet").hidden;

/** Are you sure? For anything that wipes scores. */
export function confirmSheet(title, text, yes, onYes) {
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

export function initSheets() {
  const softClose = () => !sheet.locked && closeSheet();
  $("#scrim").addEventListener("click", softClose);
  document.addEventListener("keydown", (e) => e.key === "Escape" && isOpen() && softClose());
}
