// A picture of a result, to send on WhatsApp or post: drawn on a canvas, then shared with the
// phone's own share menu (or downloaded where sharing files isn't possible).
//   card = { game: "Snooker", title: "Asha wins the match", score: "3–1", lines: [...], date }

import { toast } from "./dom.js";

const W = 1080;
const H = 1350;

/** Draw the card; returns the canvas (exported for tests). */
export function drawCard(card) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  const font = (weight, size) => `${weight} ${size}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1d6b46");
  bg.addColorStop(1, "#0e2a1f");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // two balls, like the app icon: a snooker red and a pool 8
  ball(g, 860, 230, 120, "#d0142f");
  ball(g, 980, 120, 70, "#0b0b0c");
  g.fillStyle = "#fbfaf5";
  g.beginPath();
  g.arc(980, 120, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111";
  g.font = font(800, 36);
  g.textAlign = "center";
  g.fillText("8", 980, 133);

  g.textAlign = "left";
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = font(700, 40);
  g.fillText(card.game.toUpperCase(), 90, 150);

  g.fillStyle = "#fff";
  g.font = font(800, 92);
  const titleBottom = wrap(g, card.title, 90, 420, W - 180, 104);

  if (card.score) {
    g.font = font(800, 220);
    g.fillText(card.score, 84, titleBottom + 230);
  }

  g.font = font(500, 44);
  g.fillStyle = "rgba(255,255,255,0.85)";
  let y = titleBottom + (card.score ? 360 : 120);
  for (const line of card.lines || []) {
    y = wrap(g, line, 90, y, W - 180, 58) + 70;
  }

  g.fillStyle = "rgba(255,255,255,0.6)";
  g.font = font(600, 34);
  g.fillText(card.date || new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), 90, H - 150);
  g.fillStyle = "#fff";
  g.font = font(800, 44);
  g.fillText("Scored with Chalk", 90, H - 90);
  return canvas;
}

function ball(g, x, y, r, colour) {
  const shade = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  shade.addColorStop(0, "rgba(255,255,255,0.55)");
  shade.addColorStop(0.25, colour);
  shade.addColorStop(1, "rgba(0,0,0,0.75)");
  g.fillStyle = colour;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade;
  g.fill();
}

/** Draw text wrapped to a width; returns the baseline of the last line. */
function wrap(g, text, x, y, width, lineHeight) {
  let line = "";
  for (const word of String(text).split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > width && line) {
      g.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else line = test;
  }
  g.fillText(line, x, y);
  return y;
}

/** Share the card as a picture, or download it where sharing a file isn't possible. */
export async function shareCard(card) {
  const blob = await new Promise((done) => drawCard(card).toBlob(done, "image/png"));
  if (!blob) return toast("Couldn't make the picture on this phone");
  const file = new File([blob], "chalk-result.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.title, text: `${card.title}${card.score ? ` (${card.score})` : ""}` });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast("Picture saved");
}
