// A short lesson in pages: "How snooker works", "Holding the cue"… Each page is
// [title, () => nodes]; Back and Next move through them.

import { h, btn } from "./dom.js";
import { openSheet, closeSheet } from "./sheet.js";

export function lessonSheet(pages, title, i = 0, onDone = null) {
  const [heading, body] = pages[i];
  const last = i === pages.length - 1;
  openSheet(
    title,
    h("div", { class: "lesson" }, h("h3", { text: `${i + 1}. ${heading}` }), ...body()),
    h("div", { class: "lesson-dots", "aria-hidden": "true" }, pages.map((_, j) => h("i", { class: j === i ? "now" : "" }))),
    h(
      "div",
      { class: "row" },
      i ? btn("Back", () => lessonSheet(pages, title, i - 1, onDone), "btn") : null,
      btn(last ? "Got it" : "Next", () => {
        if (!last) return lessonSheet(pages, title, i + 1, onDone);
        closeSheet();
        onDone?.();
      }, "btn primary")
    )
  );
}
