// A top-down pool table, drawn upright with the break end (the "head") at the bottom, like the
// snooker table in js/snooker/table.js. Proportions of a 9-foot table (100 × 50 inch playing surface, in mm).
// Static, trusted SVG only: no user text ever goes in here.

import { colourOf } from "./engine.js";

const W = 1270;
const L = 2540;
const CX = W / 2;
export const HEAD_STRING = L - L / 4; // a quarter of the way from the head rail
export const FOOT_SPOT = [CX, L / 4];

// A legal WPA rack, apex first: 8 in the middle of the third row, a solid and a stripe in the back corners.
export const RACK = [[1], [11, 5], [2, 8, 10], [9, 7, 14, 4], [6, 15, 13, 3, 12]];

const POCKETS = [
  [0, 0],
  [W, 0],
  [-10, L / 2],
  [W + 10, L / 2],
  [0, L],
  [W, L],
];

let uid = 0;

/** One numbered ball: solid colour, or white with a coloured band; a white disc with the number. */
export function ballSVG(n, x, y, r, id) {
  const c = `var(--p${n > 8 ? n - 8 : n})`;
  const parts = [];
  if (n > 8) {
    parts.push(
      `<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath>`,
      `<circle class="pb-white" cx="${x}" cy="${y}" r="${r}"/>`,
      `<rect clip-path="url(#${id})" x="${x - r}" y="${y - r * 0.55}" width="${r * 2}" height="${r * 1.1}" fill="${c}"/>`
    );
  } else parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`);
  parts.push(
    `<circle class="pb-edge" cx="${x}" cy="${y}" r="${r}"/>`,
    `<circle class="pb-disc" cx="${x}" cy="${y}" r="${r * 0.48}"/>`,
    `<text class="pb-num" x="${x}" y="${y + r * 0.2}" text-anchor="middle" font-size="${r * 0.62}">${n}</text>`
  );
  return parts.join("");
}

/**
 * opts:
 *   rack      draw the racked balls and the white, with labels (set-up picture)
 *   kitchen   highlight the area behind the head string (white in hand there)
 *   anywhere  highlight the whole table (white in hand anywhere)
 *   spot      highlight the foot spot with the 8 on it
 *   labels    words on the drawing
 */
export function poolSVG({ rack = false, kitchen = false, anywhere = false, spot = false, labels = true } = {}) {
  const id = `pt${++uid}`;
  const m = 90;
  const side = rack ? 340 : 0;
  const label = (x, y, text, anchor = "start") => `<text class="tag-lbl" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
  const out = [
    `<svg class="table pool${rack ? " setup" : ""}" viewBox="${-m - side} ${-m} ${W + m * 2 + side * 2} ${L + m * 2 + (labels ? 90 : 0)}" role="img" aria-hidden="true" focusable="false">`,
    `<rect class="rail" x="${-m}" y="${-m}" width="${W + m * 2}" height="${L + m * 2}" rx="70"/>`,
    `<rect class="felt pool-felt" x="0" y="0" width="${W}" height="${L}" rx="10"/>`,
    POCKETS.map(([x, y]) => `<circle class="pocket" cx="${x}" cy="${y}" r="56"/>`).join(""),
  ];
  if (anywhere) out.push(`<rect class="zone" x="0" y="0" width="${W}" height="${L}" rx="10"/>`);
  if (kitchen) out.push(`<rect class="zone" x="0" y="${HEAD_STRING}" width="${W}" height="${L - HEAD_STRING}"/>`);
  out.push(`<line class="line" x1="0" y1="${HEAD_STRING}" x2="${W}" y2="${HEAD_STRING}" stroke-dasharray="${rack || kitchen ? "0" : "30 24"}"/>`, `<circle class="spot" cx="${FOOT_SPOT[0]}" cy="${FOOT_SPOT[1]}" r="12"/>`);

  if (rack) {
    const r = 56;
    const dy = r * 2 * 0.866 + 2;
    const gap = r * 2 + 2;
    RACK.forEach((row, k) => row.forEach((n, i) => out.push(ballSVG(n, CX + (i - (row.length - 1) / 2) * gap, FOOT_SPOT[1] - k * dy, r, `${id}b${n}`))));
    const back = FOOT_SPOT[1] - 4 * dy;
    out.push(
      label(CX + r + 40, FOOT_SPOT[1] + 30, "← foot spot"),
      label(CX + gap + r + 40, FOOT_SPOT[1] - 2 * dy + 30, "← the 8"),
      label(CX - 2 * gap - r - 30, back + 30, "solid →", "end"),
      label(CX + 2 * gap + r + 30, back + 30, "← stripe"),
      `<circle class="b b-white" cx="${CX}" cy="${HEAD_STRING + 230}" r="${r}"/>`,
      label(CX, HEAD_STRING + 400, "White: behind the line", "middle"),
      label(W - 30, HEAD_STRING - 30, "the line (head string)", "end")
    );
  }
  if (anywhere) out.push(`<circle class="b b-white" cx="${CX + 160}" cy="${L / 2 + 260}" r="60"/>`, labels ? label(CX, L / 2 - 40, "Anywhere on the table", "middle") : "");
  if (kitchen && !rack) out.push(`<circle class="b b-white" cx="${CX}" cy="${HEAD_STRING + 300}" r="60"/>`, labels ? label(CX, HEAD_STRING - 60, "Behind this line", "middle") : "");
  if (spot) out.push(`<circle class="ring" cx="${FOOT_SPOT[0]}" cy="${FOOT_SPOT[1]}" r="150"/>`, ballSVG(8, FOOT_SPOT[0], FOOT_SPOT[1], 80, `${id}s8`), labels ? label(CX + 175, FOOT_SPOT[1] + 30, "Foot spot") : "");
  if (labels) out.push(`<text class="end big" x="${CX}" y="${L + 160}" text-anchor="middle">YOU BREAK FROM THIS END</text>`);
  out.push("</svg>");
  return out.join("");
}

export { colourOf };
