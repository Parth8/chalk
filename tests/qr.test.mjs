import { test } from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrSVG } from "../js/core/qr.js";

test("a game link becomes a scannable QR code", () => {
  const url = "https://parth8.github.io/snooker/?g=abcdefghjk";
  const m = qrMatrix(url);
  assert.equal(m.length, m[0].length);
  assert.equal((m.length - 17) % 4, 0, "a real QR size (21, 25, 29…)");
  // the three finder squares: a dark 7×7 ring in three corners
  for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) {
    assert.ok(m[r][c] && m[r + 6][c + 6] && m[r + 3][c + 3], "finder corner and centre dark");
    assert.ok(!m[r + 1][c + 1], "with a light ring inside");
  }
  const svg = qrSVG(url);
  assert.match(svg, /^<svg class="qr"/);
  assert.doesNotMatch(svg, /abcdefghjk/, "only path data goes into the SVG, never the text");
});
