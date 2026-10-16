// A QR code for a shared game's link, so the other player can scan it instead of being sent it.
// Encoding by qrcode-generator (MIT), vendored unmodified in /vendor (its qrcode.mjs saved as .js, which
// every web host serves as JavaScript). Drawn here as one SVG path.

import qrcode from "../../vendor/qrcode-generator/qrcode.js";

/** The dark modules of a QR code for some text, as rows of booleans. */
export function qrMatrix(text) {
  const qr = qrcode(0, "M"); // smallest version that fits, medium error correction
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** An SVG string (black on white, with the quiet zone scanners need). Only path data goes in. */
export function qrSVG(text) {
  const rows = qrMatrix(text);
  const n = rows.length;
  let d = "";
  rows.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c} ${r}h1v1h-1z`)));
  return `<svg class="qr" viewBox="-4 -4 ${n + 8} ${n + 8}" role="img" aria-label="QR code for the game link" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
