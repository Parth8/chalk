// Which screen is showing, and keeping the phone awake while a game is on it.

import { $ } from "../core/dom.js";

export function show(view) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `view-${view}`;
  wake(view === "game");
  window.scrollTo(0, 0);
}

export const showing = (view) => !$(`#view-${view}`).hidden;

let lock = null;
let wanted = false;
let asking = false;
async function wake(on) {
  wanted = on;
  if (!on) {
    const held = lock;
    lock = null;
    held?.release().catch(() => {});
    return;
  }
  if (lock || asking || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  asking = true;
  try {
    const held = await navigator.wakeLock.request("screen");
    if (!wanted) held.release().catch(() => {}); // left the game while asking
    else {
      lock = held;
      held.addEventListener("release", () => lock === held && (lock = null));
    }
  } catch {
  } finally {
    asking = false;
  }
}

// the lock is dropped when the phone sleeps or the tab is hidden: take it again on return
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && showing("game") && wake(true));
