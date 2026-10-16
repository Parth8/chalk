// "Add to home screen": the steps for this phone and browser (pictures for Apple devices).

import { h, btn, toast } from "../core/dom.js";
import { openSheet, closeSheet } from "../core/sheet.js";
import { installWay, installPlace, appleGuide, canOpenSafari, onInstallChange, promptInstall } from "../core/install.js";
import { guideArt } from "../core/install-guide.js";

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;

export function installSheet() {
  const way = installWay();
  const onHome = installPlace === "home";
  const b = (text) => h("b", { text });
  const steps = (...items) => h("ol", { class: "install-steps" }, items.map((parts) => h("li", {}, h("span", {}, ...parts))));
  let how = null;
  if (way === "prompt")
    how = btn(onHome ? "Add to home screen" : "Install", async () => {
      closeSheet();
      if (await promptInstall()) toast(onHome ? "Chalk is on your home screen" : "Chalk is installed");
    }, "btn primary big");
  else if ((way === "ios" || way === "mac") && appleGuide) how = appleSteps(appleGuide);
  else if (way === "ios") how = steps(["Open your browser's ", b("Share"), " menu ", h("span", { html: SHARE_ICON }), "."], ["Choose ", b("Add to Home Screen"), "."]);
  else if (way === "android") how = steps(["Open your browser's menu ", b("⋮"), "."], ["Choose ", b("Add to Home screen"), " or ", b("Install app"), "."]);
  else if (way === "chrome") how = steps(["Open Chrome's menu ", b("⋮"), " and choose ", b("Cast, save, and share"), "."], ["Choose ", b("Install page as app"), "."]);
  else if (way === "edge") how = steps(["Open Edge's menu ", b("…"), " and choose ", b("Apps"), "."], ["Choose ", b("Install this site as an app"), "."]);
  openSheet(
    onHome ? "Keep it on your home screen" : "Install the app",
    h("p", { class: "lead-text", text: "It opens full-screen like an app and keeps the screen awake while you play. No app store, nothing to update." }),
    how || h("p", { class: "note", text: "This browser can't add it. Try Safari on iPhone or Chrome on Android." })
  );
}

function appleSteps(kind) {
  const b = (text) => h("b", { text });
  const here = location.origin + location.pathname;
  if (kind === "open-safari")
    return h(
      "div",
      { style: "display:flex;flex-direction:column;gap:10px" },
      h("p", { class: "lead-text", text: canOpenSafari ? "In-app browsers can't add to the home screen. Open this page in Safari, then add it from there." : "Only Safari can add it from here. Copy the link, open Safari and paste it in." }),
      canOpenSafari ? h("a", { class: "btn primary", href: `x-safari-${here}`, rel: "noopener" }, "Open in Safari") : null,
      btn("Copy link", async () => {
        try {
          await navigator.clipboard.writeText(here);
          toast("Link copied. Now open Safari and paste it in.");
        } catch {
          toast("Couldn't copy. Long-press the address bar instead.");
        }
      })
    );
  const text = {
    firefox: [["Tap the menu ", b("☰"), " at the bottom right."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    edge: [["Tap ", b("•••"), " at the bottom of the screen."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    other: [["Open your browser's ", b("Share"), " menu."], ["Choose ", b("Add to Home Screen"), "."]],
  }[kind];
  if (text) return h("ol", { class: "install-steps" }, text.map((t) => h("li", {}, h("span", {}, ...t))));
  const addHome = ["Scroll down and choose ", b("Add to Home Screen"), "."];
  const captions = {
    safari: [["Tap ", b("Share"), " in the toolbar."], addHome],
    safari26: [["Tap ", b("•••"), ", then ", b("Share"), "."], addHome],
    ipad: [["Tap ", b("Share"), " at the top right."], addHome],
    chrome: [["Tap ", b("Share"), " in the address bar."], addHome],
    mac: [["In the menu bar, open ", b("File"), "."], ["Choose ", b("Add to Dock"), "."]],
  }[kind];
  return h(
    "ol",
    { class: "guide-pics" },
    guideArt[kind].map((art, i) => h("li", {}, h("span", { class: "guide-art", html: art }), h("span", { class: "guide-cap" }, ...captions[i])))
  );
}

/** Show the install links only where adding to the home screen is possible. */
export function syncInstallLinks() {
  for (const el of document.querySelectorAll(".install-link")) el.hidden = !installWay();
}
onInstallChange(syncInstallLinks);
