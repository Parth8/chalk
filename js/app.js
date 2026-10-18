// Chalk: start-up and moving between screens. Each screen lives in js/screens/; the rules and
// screens of each game live in js/snooker/ and js/pool/; what they share is in js/core/.

import { $ } from "./core/dom.js";
import { initSheets, closeSheet } from "./core/sheet.js";
import { session, onChange, openLocal, loadLocal, leave } from "./core/session.js";
import { seats } from "./core/api.js";
import { endTour } from "./core/coach.js";
import { lessonSheet } from "./core/lessons.js";
import * as sync from "./core/sync.js";
import { gameUI, pickedGame, pickGame } from "./games.js";
import { show, showing } from "./screens/views.js";
import { initHome, showHome, showPick } from "./screens/home.js";
import { renderJoin, renderLoading, renderJoinError } from "./screens/join.js";
import { initGame, renderGame } from "./screens/game.js";
import { menuSheet } from "./screens/menu.js";
import { askSheet } from "./screens/ask.js";
import { installSheet, syncInstallLinks } from "./screens/install.js";
import { TECHNIQUE } from "./screens/technique.js";

const nav = {
  home: goHome,
  openLocal(m) {
    sync.close();
    // a history entry for the game, so the phone's Back button comes home instead of closing the app
    if (location.search) history.replaceState(null, "", location.pathname);
    if (history.state?.screen === "local") history.replaceState({ screen: "game" }, "");
    else if (!history.state?.screen) history.pushState({ screen: "game" }, "");
    openLocal(m); // → route()
  },
  async openShared(id, push = false) {
    if (push) history.pushState(null, "", `?g=${id}`);
    renderLoading();
    show("join");
    try {
      await sync.open(id); // → route()
    } catch (err) {
      renderJoinError(err, () => nav.openShared(id), () => (goHome(), $("#start-local").click()));
    }
  },
};

/** Whenever the match changes: show the screen it belongs on. */
function route() {
  if (session.mode === "local") {
    if (!showing("game")) show("game");
    return renderGame();
  }
  if (session.mode !== "online" || !session.match) return;
  // a shared game shows once both sides are in (to players and watchers alike); until then, the lobby
  if (session.ready) {
    if (!showing("game")) show("game");
    renderGame();
  } else {
    renderJoin();
    if (!showing("join")) show("join");
  }
}

function goHome() {
  // came from home by a history entry of ours: step back to it (boot() then shows home)
  if (history.state?.screen) return history.back();
  closeSheet();
  endTour();
  sync.close();
  leave();
  if (location.search) history.replaceState(null, "", location.pathname); // Back shouldn't reopen a game you left
  showHome();
}

function boot() {
  closeSheet();
  endTour();
  const id = new URLSearchParams(location.search).get("g");
  if (id && /^[a-z2-9]{10}$/.test(id)) return nav.openShared(id);
  if (id !== null) {
    show("join");
    return renderJoinError({ code: "no_game", message: "That game link doesn't look right. Check it was copied in full, or ask for it again." }, null, () => (goHome(), $("#start-local").click()));
  }
  if (history.state?.screen) history.replaceState(null, ""); // came Back from a game or the names screen
  sync.close();
  leave();
  if (!pickedGame()) {
    // first start: snooker or pool? (people who already scored snooker here stay on it)
    if (loadLocal("snooker") || Object.keys(seats()).length) pickGame("snooker");
    else return showPick();
  }
  showHome();
}

initSheets();
initHome(nav);
initGame();
onChange(route);
syncInstallLinks();

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-go=home]")) return goHome();
  const open = e.target.closest("[data-open]")?.dataset.open;
  if (open === "ask") askSheet();
  if (open === "menu") menuSheet(nav);
  if (open === "install") installSheet();
  if (open === "technique") lessonSheet(TECHNIQUE, "Cue technique basics");
  if (open === "learn") lessonSheet(gameUI().lessons, gameUI().lessonsTitle);
});
window.addEventListener("popstate", boot);
boot();

// Offline after the first visit (club basements rarely have signal). Not on localhost, so edits show up.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
