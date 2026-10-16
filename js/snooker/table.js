// A top-down snooker table, drawn upright with the baulk end at the bottom (where you stand to
// break), so left and right on screen match left and right at the table. Real proportions in mm.
// Static, trusted SVG only: no user text ever goes in here.

const W = 1778; // playing area width
const L = 3569; // playing area length
const BAULK = L - 737; // baulk line, 737 mm from the bottom cushion
const D = 292; // radius of the D
const CX = W / 2;
const R = 26; // ball radius

export const SPOT = {
  green: [CX - D, BAULK], // left of the D, seen from the baulk end
  brown: [CX, BAULK],
  yellow: [CX + D, BAULK],
  blue: [CX, L / 2],
  pink: [CX, L / 4],
  black: [CX, 324],
};

/** Where a colour goes when its own spot is covered: the highest-value spot that's free. */
export const FALLBACK = ["black", "pink", "blue", "brown", "green", "yellow"];
export const spotOrder = (ball) => [ball, ...FALLBACK.filter((b) => b !== ball)];

const POCKETS = [
  [0, 0],
  [W, 0],
  [-8, L / 2],
  [W + 8, L / 2],
  [0, L],
  [W, L],
];

const ball = (b, x, y, r = R * 1.5) => `<circle class="b b-${b}" cx="${x}" cy="${y}" r="${r}"/>`;

function rack(n) {
  // apex just behind the pink, the triangle opening towards the black
  const rows = n >= 15 ? 5 : n >= 10 ? 4 : 3;
  const out = [];
  const dy = R * 2 * 0.866 + 1;
  let left = n;
  for (let row = 0; row < rows && left > 0; row++) {
    const y = SPOT.pink[1] - R * 2 - 4 - row * dy;
    for (let i = 0; i <= row && left > 0; i++, left--) out.push(ball("red", CX + (i - row / 2) * (R * 2 + 1), y, R));
  }
  return out.join("");
}

/**
 * opts:
 *   spot    a colour whose spot to highlight ("pink")
 *   ball    the ball going on it (defaults to spot), e.g. pink going on the black spot
 *   d       highlight the D (white in hand)
 *   rack    draw the full set-up, with this many reds
 *   labels  show the colour initials at each spot
 */
export function tableSVG({ spot = null, ball: b = spot, d = false, rack: reds = 0, labels = !reds } = {}) {
  const m = 120;
  const parts = [
    `<svg class="table" viewBox="${-m} ${-m} ${W + m * 2} ${L + m * 2}" role="img" aria-hidden="true" focusable="false">`,
    `<rect class="rail" x="${-m}" y="${-m}" width="${W + m * 2}" height="${L + m * 2}" rx="90"/>`,
    `<rect class="felt" x="0" y="0" width="${W}" height="${L}" rx="12"/>`,
    POCKETS.map(([x, y]) => `<circle class="pocket" cx="${x}" cy="${y}" r="62"/>`).join(""),
    `<line class="line" x1="0" y1="${BAULK}" x2="${W}" y2="${BAULK}"/>`,
    `<path class="line${d ? " d-hot" : ""}" d="M${CX - D} ${BAULK} A${D} ${D} 0 0 0 ${CX + D} ${BAULK}${d ? " Z" : ""}"/>`,
  ];
  for (const [name, [x, y]] of Object.entries(SPOT)) {
    if (reds) parts.push(ball(name, x, y, R));
    else parts.push(`<circle class="spot" cx="${x}" cy="${y}" r="13"/>`);
    if (labels && name !== spot) {
      const [lx, ly, anchor] = name === "green" ? [x - 50, y - 50, "end"] : name === "yellow" ? [x + 50, y - 50, "start"] : name === "brown" ? [x, y + 110, "middle"] : [x + 60, y + 24, "start"];
      parts.push(`<text class="lbl" x="${lx}" y="${ly}" text-anchor="${anchor}">${name[0].toUpperCase() + name.slice(1)}</text>`);
    }
  }
  if (reds) {
    parts.push(rack(reds));
    parts.push(ball("white", CX - 120, BAULK + 150, R));
  }
  if (d) parts.push(ball("white", CX + 60, BAULK + 130, 70));
  if (spot) {
    const [x, y] = SPOT[spot];
    parts.push(`<circle class="ring" cx="${x}" cy="${y}" r="190"/>`, ball(b, x, y, 105));
  }
  if (labels || reds) parts.push(`<text class="end" x="${CX}" y="${L + 88}" text-anchor="middle">YOU BREAK FROM THIS END</text>`);
  parts.push("</svg>");
  return parts.join("");
}

/**
 * The table ready to play, every ball labelled, for people setting up for the first time.
 * Balls are drawn bigger than life so they're easy to see on a phone.
 */
export function setupSVG(reds = 15) {
  const r = 44;
  const m = 120;
  const label = (x, y, text, anchor = "start") => `<text class="tag-lbl" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
  const out = [
    `<svg class="table setup" viewBox="${-m - 420} ${-m} ${W + m * 2 + 840} ${L + m * 2 + 60}" role="img" aria-label="Where every ball goes at the start">`,
    `<rect class="rail" x="${-m}" y="${-m}" width="${W + m * 2}" height="${L + m * 2}" rx="90"/>`,
    `<rect class="felt" x="0" y="0" width="${W}" height="${L}" rx="12"/>`,
    POCKETS.map(([x, y]) => `<circle class="pocket" cx="${x}" cy="${y}" r="62"/>`).join(""),
    `<line class="line" x1="0" y1="${BAULK}" x2="${W}" y2="${BAULK}"/>`,
    `<path class="line" d="M${CX - D} ${BAULK} A${D} ${D} 0 0 0 ${CX + D} ${BAULK}"/>`,
  ];
  // reds: a tight triangle, point towards the pink, not touching it
  const rows = reds >= 15 ? 5 : reds >= 10 ? 4 : 3;
  const dy = r * 2 * 0.866 + 2;
  let left = reds;
  for (let row = 0; row < rows && left > 0; row++) {
    const y = SPOT.pink[1] - r * 2 - 10 - row * dy;
    for (let i = 0; i <= row && left > 0; i++, left--) out.push(ball("red", CX + (i - row / 2) * (r * 2 + 2), y, r));
  }
  const topRow = SPOT.pink[1] - r * 2 - 10 - (rows - 1) * dy;
  out.push(label(CX - rows * r - 40, (topRow + SPOT.pink[1]) / 2 - 20, `${reds} reds`, "end"), label(CX - rows * r - 40, (topRow + SPOT.pink[1]) / 2 + 70, "in a triangle", "end"));
  for (const [name, [x, y]] of Object.entries(SPOT)) out.push(ball(name, x, y, r));
  out.push(
    label(CX + 90, SPOT.black[1] + 25, "Black 7"),
    label(CX + 90, SPOT.pink[1] + 25, "Pink 6"),
    label(CX + 90, SPOT.blue[1] + 25, "Blue 5"),
    label(SPOT.green[0] - 70, BAULK - 70, "Green 3", "end"),
    label(CX, BAULK - 80, "Brown 4", "middle"),
    label(SPOT.yellow[0] + 70, BAULK - 70, "Yellow 2"),
    ball("white", CX, BAULK + 170, r),
    label(CX, BAULK + 400, "White: anywhere in the D", "middle"),
    `<text class="end big" x="${CX}" y="${L + 170}" text-anchor="middle">YOU BREAK FROM THIS END</text>`,
    "</svg>"
  );
  return out.join("");
}

/** Words for where a spot is, to go with the picture. */
export const SPOT_WORDS = {
  yellow: "the right-hand corner of the D, standing at the D end",
  green: "the left-hand corner of the D, standing at the D end",
  brown: "the middle of the line, where it meets the D",
  blue: "the very middle of the table",
  pink: "halfway between the blue and the far cushion",
  black: "near the far cushion",
};
