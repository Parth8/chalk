// An on-screen coin toss for who breaks (or who plays a re-spotted black): heads for one side,
// tails for the other, a fair random result, and a spin you can watch.

import { h, btn } from "./dom.js";
import { openSheet } from "./sheet.js";
import { tap } from "./sound.js";

const SPIN_MS = 1400;

export const flip = () => crypto.getRandomValues(new Uint8Array(1))[0] & 1; // 0 heads, 1 tails

/**
 * tossSheet({ title, intro, names: [heads, tails], after(winner) => nodes to show with the result })
 */
export function tossSheet({ title = "Coin toss", intro = "", names, after }) {
  const coin = h("div", { class: "coin", "aria-hidden": "true" }, h("span", { class: "face heads", text: "H" }), h("span", { class: "face tails", text: "T" }));
  const result = h("div", { class: "toss-result", "aria-live": "polite" });
  const go = btn("Toss the coin", () => {
    tap();
    go.disabled = true;
    const winner = flip();
    coin.classList.remove("show-heads", "show-tails");
    void coin.offsetWidth; // restart the spin
    coin.classList.add("spin", winner ? "show-tails" : "show-heads");
    const reveal = () => {
      result.replaceChildren(h("p", { class: "toss-call", text: `${winner ? "Tails" : "Heads"}! ${names[winner]} wins the toss.` }), ...(after ? after(winner) : []));
      result.scrollIntoView({ block: "nearest", behavior: "smooth" }); // the result's buttons can be below a small screen
    };
    setTimeout(reveal, matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : SPIN_MS);
  }, "btn primary big");
  openSheet(
    title,
    intro ? h("p", { class: "lead-text", text: intro }) : null,
    h("div", { class: "toss-sides" }, h("span", {}, h("b", { text: "Heads" }), ` ${names[0]}`), h("span", {}, h("b", { text: "Tails" }), ` ${names[1]}`)),
    h("div", { class: "coin-stage" }, coin),
    go,
    result
  );
}
