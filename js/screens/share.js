// Sending a shared game's link (share menu, or copy), and its QR code for the phone next to you.

import { h, btn, toast } from "../core/dom.js";
import { qrSVG } from "../core/qr.js";
import { session } from "../core/session.js";
import { gameUI } from "../games.js";

export const shareUrl = (id = session.id) => `${location.origin}${location.pathname}?g=${id}`;

export async function shareLink() {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Chalk", text: `Join my ${gameUI().label.toLowerCase()} game:`, url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast("Couldn't copy: press and hold the link instead");
  }
}

/** The link three ways: a QR code to scan, the address, and a share button. */
export function linkBlock() {
  const url = shareUrl();
  return h(
    "div",
    { class: "link-block" },
    h("div", { class: "qr-wrap", html: qrSVG(url) }),
    h("p", { class: "note center", text: "Scan with the other phone's camera, or send the link." }),
    h("div", { class: "share-link", text: url }),
    btn("Share link", shareLink, "btn primary")
  );
}
