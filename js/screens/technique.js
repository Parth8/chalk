// Technique basics for complete beginners: the same for snooker and pool. Each page has a
// simple drawing (our own static SVG) and a few plain words.

import { h } from "../core/dom.js";

const art = (body, label) => `<svg class="tech-art" viewBox="0 0 240 140" role="img" aria-label="${label}">${body}</svg>`;

const CUE = "#c99a5b";
const SKIN = "#e0b088";
const CLOTH = "#1d6b46";

const STANCE = art(
  `<rect x="0" y="96" width="240" height="10" rx="3" fill="${CLOTH}"/><rect x="0" y="106" width="240" height="34" fill="#4a3424"/>
   <circle cx="214" cy="92" r="4" fill="#f4f1e8"/>
   <line x1="38" y1="60" x2="208" y2="91" stroke="${CUE}" stroke-width="4" stroke-linecap="round"/>
   <g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
     <circle cx="96" cy="58" r="9"/>
     <path d="M88 64 L40 70"/>
     <path d="M40 70 L28 138"/><path d="M40 70 L58 104 L52 138"/>
     <path d="M80 66 L118 94"/>
     <path d="M52 68 L46 58 L42 62"/>
   </g>
   <path d="M118 94 h12" stroke="${SKIN}" stroke-width="6" stroke-linecap="round"/>
   <text x="120" y="24" class="tech-note">chin low, over the cue</text>`,
  "A player bent over the table, chin low over the cue, back leg straight"
);

const GRIP = art(
  `<line x1="20" y1="104" x2="230" y2="80" stroke="${CUE}" stroke-width="7" stroke-linecap="round"/>
   <line x1="80" y1="10" x2="80" y2="88" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
   <ellipse cx="80" cy="97" rx="13" ry="11" fill="${SKIN}"/>
   <path d="M60 30 L100 30" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
   <text x="104" y="34" class="tech-note">forearm hangs straight down</text>
   <text x="104" y="126" class="tech-note">loose, like a handshake</text>`,
  "A hand holding the back of the cue loosely, forearm hanging straight down"
);

const BRIDGE = art(
  `<rect x="0" y="108" width="240" height="32" fill="${CLOTH}"/>
   <path d="M60 110 Q66 70 92 64 L104 60 Q112 48 120 58 L124 66 Q150 66 176 110 Z" fill="${SKIN}" stroke="#a87650" stroke-width="2"/>
   <path d="M70 110 l-6 18 M92 110 l-2 18 M150 110 l2 18 M172 110 l8 18" stroke="${SKIN}" stroke-width="9" stroke-linecap="round"/>
   <circle cx="114" cy="56" r="7" fill="${CUE}" stroke="#7a5a30" stroke-width="2"/>
   <text x="134" y="34" class="tech-note">cue rests in the V</text>
   <path d="M132 36 L120 50" stroke="currentColor" stroke-width="2"/>`,
  "A hand flat on the cloth, fingers spread, the thumb raised to make a V that the cue slides in"
);

const CHALK = art(
  `<line x1="10" y1="70" x2="150" y2="70" stroke="${CUE}" stroke-width="10" stroke-linecap="round"/>
   <rect x="150" y="64" width="10" height="12" rx="3" fill="#2a6bc4"/>
   <rect x="168" y="50" width="40" height="40" rx="4" fill="#3b82d6"/>
   <path d="M168 50 l8 -8 h40 l-8 8 Z" fill="#5d9be3"/><path d="M208 50 l8 -8 v40 l-8 8 Z" fill="#2a6bc4"/>
   <text x="20" y="118" class="tech-note">brush the tip, every shot or two</text>`,
  "Chalk being brushed onto the tip of the cue"
);

const AIM = art(
  `<rect x="0" y="0" width="240" height="140" rx="10" fill="${CLOTH}"/>
   <circle cx="222" cy="18" r="13" fill="#0b2a1c"/>
   <line x1="222" y1="18" x2="128" y2="88" stroke="#fff" stroke-width="2" stroke-dasharray="5 5" opacity="0.7"/>
   <circle cx="150" cy="72" r="11" fill="#d0142f"/>
   <circle cx="132" cy="85" r="11" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>
   <line x1="30" y1="122" x2="128" y2="88" stroke="#fff" stroke-width="2"/>
   <circle cx="30" cy="122" r="11" fill="#f4f1e8"/>
   <text x="16" y="34" class="tech-note light">aim the white at the</text>
   <text x="16" y="52" class="tech-note light">dotted "ghost" ball</text>`,
  "Top view: a line from the pocket through the red ball; the white is aimed at a dotted ghost ball touching the red on that line"
);

const STROKE = art(
  `<line x1="30" y1="80" x2="200" y2="80" stroke="${CUE}" stroke-width="7" stroke-linecap="round"/>
   <circle cx="218" cy="80" r="9" fill="#f4f1e8"/>
   <path d="M60 60 h-30 m0 0 l8 -6 m-8 6 l8 6" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
   <path d="M90 60 h50 m0 0 l-8 -6 m8 6 l-8 6" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
   <text x="30" y="40" class="tech-note">back slowly · pause · straight through</text>
   <text x="30" y="118" class="tech-note">softer than you think. Stay still after.</text>`,
  "The cue drawn back slowly, a pause, then pushed straight through the white"
);

const REST = art(
  `<rect x="0" y="96" width="240" height="44" fill="${CLOTH}"/>
   <line x1="20" y1="70" x2="196" y2="96" stroke="#7d8a84" stroke-width="5" stroke-linecap="round"/>
   <path d="M188 86 l16 20 M204 86 l-16 20" stroke="#7d8a84" stroke-width="5" stroke-linecap="round"/>
   <line x1="30" y1="48" x2="210" y2="90" stroke="${CUE}" stroke-width="5" stroke-linecap="round"/>
   <circle cx="222" cy="92" r="5" fill="#f4f1e8"/>
   <text x="14" y="24" class="tech-note">can't reach? use the rest</text>`,
  "A cue resting on the cross-shaped head of a rest that lies flat on the table"
);

/** The lesson pages: [title, () => nodes]. */
export const TECHNIQUE = [
  [
    "Stand steady",
    () => [
      h("div", { class: "tech-pic", html: STANCE }),
      h("p", {}, "Feet about shoulder-width apart, your back foot in line with the shot. Bend the front knee, keep the back leg fairly straight, and lean forward so your ", h("b", { text: "chin is low, just over the cue" }), "."),
      h("p", {}, "Line your eyes up behind the cue, like looking down a rifle sight."),
    ],
  ],
  [
    "Hold it loosely",
    () => [
      h("div", { class: "tech-pic", html: GRIP }),
      h("p", {}, "Hold the back of the cue with your thumb and first two fingers, ", h("b", { text: "loose, like a handshake" }), ". A tight grip twists the cue."),
      h("p", {}, "At the moment you hit, your forearm should hang straight down."),
    ],
  ],
  [
    "Make a bridge",
    () => [
      h("div", { class: "tech-pic", html: BRIDGE }),
      h("p", {}, "Put your other hand flat on the cloth, fingers spread wide. Lift your thumb tight against your first finger to make a ", h("b", { text: "V" }), " and slide the cue in it."),
      h("p", {}, "Keep the bridge about a hand's length from the white, and press down so it doesn't move."),
    ],
  ],
  [
    "Chalk the tip",
    () => [
      h("div", { class: "tech-pic", html: CHALK }),
      h("p", {}, "Brush chalk over the tip every shot or two. Without it the cue can slip off the ball (a ", h("b", { text: "miscue" }), ")."),
      h("p", {}, "Brush, don't twist the tip into the chalk."),
    ],
  ],
  [
    "Aim at the ghost ball",
    () => [
      h("div", { class: "tech-pic", html: AIM }),
      h("p", {}, "Picture a line from the pocket through the ball you want to pot. Now imagine a second ball touching it on that line, on the far side from the pocket: the ", h("b", { text: "ghost ball" }), "."),
      h("p", {}, "Send the white to where the ghost ball sits. Straight shots first: they're the easiest to learn on."),
    ],
  ],
  [
    "A smooth, straight stroke",
    () => [
      h("div", { class: "tech-pic", html: STROKE }),
      h("p", {}, "Take two or three slow practice swings. Then draw back, ", h("b", { text: "pause" }), ", and push straight through the white."),
      h("p", {}, "Most beginners hit too hard: half the power is usually plenty. Stay down and still until the ball stops."),
    ],
  ],
  [
    "Can't reach? Use the rest",
    () => [
      h("div", { class: "tech-pic", html: REST }),
      h("p", {}, "For far shots, lay the ", h("b", { text: "rest" }), " (a stick with a cross on the end; in pool it's called a bridge) flat on the table and rest the cue on it. Hold the back of the cue with your fingers, palm down, elbow out."),
      h("p", {}, "Don't climb onto the table: one foot must touch the floor, or it's a foul."),
    ],
  ],
];
