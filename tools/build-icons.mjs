// Renders the app icon in every size the site needs, from the one mark below.
//   NODE_PATH=$(npm root -g) node tools/build-icons.mjs
//
// The mark: a red and a black ball on the cloth, the two you'll tap most.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * full: fill the whole square (iOS and Android round the corners themselves).
 * k: scale the drawing about the centre (maskable icons keep it inside the safe circle).
 */
export function mark({ full = false, k = 1, id = "s" } = {}) {
  const rx = full ? 0 : 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="${id}f" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1f8a5a"/><stop offset="1" stop-color="#0d4a30"/></linearGradient>
    <radialGradient id="${id}r" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ff5a6e"/><stop offset="0.55" stop-color="#c8102e"/><stop offset="1" stop-color="#6e0616"/></radialGradient>
    <radialGradient id="${id}k" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#5a5f66"/><stop offset="0.5" stop-color="#16181a"/><stop offset="1" stop-color="#000"/></radialGradient>
    <radialGradient id="${id}s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="64" height="64" rx="${rx}" fill="url(#${id}f)"/>
  <g transform="translate(32 32) scale(${k}) translate(-32 -32)">
    <ellipse cx="44" cy="25.5" rx="11" ry="4" fill="url(#${id}s)"/>
    <circle cx="42" cy="20" r="9" fill="url(#${id}k)"/>
    <circle cx="39" cy="16.6" r="2.2" fill="#fff" fill-opacity="0.8"/>
    <ellipse cx="27" cy="47" rx="17" ry="5.5" fill="url(#${id}s)"/>
    <circle cx="25" cy="38" r="14" fill="url(#${id}r)"/>
    <circle cx="20.2" cy="32.6" r="3.4" fill="#fff" fill-opacity="0.85"/>
  </g>
</svg>`;
}

const ROOT = new URL("../", import.meta.url);
const pngs = {
  "icons/apple-touch-icon.png": [180, mark({ full: true })],
  "icons/icon-192.png": [192, mark()],
  "icons/icon-512.png": [512, mark()],
  "icons/icon-maskable-512.png": [512, mark({ full: true, k: 0.78 })],
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  writeFileSync(new URL("favicon.svg", ROOT), mark().replace(/\n\s*/g, ""));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  for (const [file, [size, svg]] of Object.entries(pngs)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
    await page.screenshot({ path: new URL(file, ROOT).pathname, omitBackground: true });
    await page.close();
    console.log(file, size);
  }
  await browser.close();
}
