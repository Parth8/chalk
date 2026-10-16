// Which screen is showing, and keeping the phone awake while a game is on it.

import { $ } from "../core/dom.js";

export function show(view) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `view-${view}`;
  wake(view === "game");
  window.scrollTo(0, 0);
}

export const showing = (view) => !$(`#view-${view}`).hidden;

let lock = null;
async function wake(on) {
  try {
    if (on && !lock && "wakeLock" in navigator && document.visibilityState === "visible") {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}

// the lock is dropped when the phone sleeps or the tab is hidden: take it again on return
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && showing("game") && wake(true));
