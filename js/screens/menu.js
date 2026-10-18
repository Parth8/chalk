// The ⋯ menu during a game: give up, restart, the link and QR code, a coin toss, how to set up,
// lessons, sounds and spoken prompts, theme, and leaving.

import { h, btn, toast } from "../core/dom.js";
import { openSheet, closeSheet, confirmSheet } from "../core/sheet.js";
import { session, act, can, state, names, isShared, restartLocal, deleteLocal } from "../core/session.js";
import { gameOf, gamesWon, sideName } from "../core/match.js";
import { forgetSeat } from "../core/api.js";
import { lessonSheet } from "../core/lessons.js";
import { tossSheet } from "../core/toss.js";
import { startTour } from "../core/coach.js";
import { shareCard } from "../core/share-card.js";
import { soundSettings, setSound, canSpeak, sayNow } from "../core/sound.js";
import * as store from "../core/store.js";
import { installWay, installPlace } from "../core/install.js";
import { GAMES, gameUI, pickGame } from "../games.js";
import { askSheet } from "./ask.js";
import { installSheet } from "./install.js";
import { linkBlock } from "./share.js";
import { TECHNIQUE } from "./technique.js";
import { tourSteps } from "./game.js";

/** nav: { home() } — how to leave the game screen. Help first; anything that wipes scores last. */
export function menuSheet(nav) {
  const ui = gameUI();
  const s = state();
  const n = names();
  const shared = isShared();
  const other = shared && session.seat !== null ? n[1 - session.seat] : null;
  const items = [];

  if (shared) {
    items.push(
      h("p", { class: "lead-text", text: session.seat === null ? "You're watching. Only the two sides can score." : `You're ${n[session.seat]}. You score your own turns; the other phone scores theirs.` }),
      btn("Invite: show the link and QR code", () => openSheet("Invite to this game", linkBlock()))
    );
  }

  items.push(
    h("h3", { text: "Help" }),
    btn("Rules & quick answers", () => askSheet()),
    btn(ui.setupTitle, () => openSheet(ui.setupTitle, ...ui.setupPicture(session.match))),
    btn(`${ui.lessonsTitle} (1 minute)`, () => lessonSheet(ui.lessons, ui.lessonsTitle)),
    btn("Holding and aiming the cue", () => lessonSheet(TECHNIQUE, "Cue technique basics")),
    btn("Show me around the screen", () => (closeSheet(), startTour(tourSteps(ui)))),
    btn("Toss a coin", () => tossSheet({ title: "Coin toss", names: [sideName(session.match, 0), sideName(session.match, 1)] }))
  );
  if (session.match.frames.some((f, i) => i < session.match.frames.length - 1 || s.over)) items.push(btn("Share the score so far", () => shareSoFar(ui)));

  items.push(h("h3", { text: "Sound and look" }), ...settings());
  if (installWay()) items.push(btn(installPlace === "home" ? "Add to home screen" : "Install the app", installSheet));

  items.push(h("h3", { text: "This match" }));
  const otherGame = Object.values(GAMES).find((g) => g.id !== ui.id);
  items.push(
    btn(shared ? "Leave (you can come back)" : "Home (this match stays saved)", () => (closeSheet(), nav.home())),
    btn(`Switch to ${otherGame.label}`, () => {
      closeSheet();
      pickGame(otherGame.id);
      nav.home(); // this match stays saved: "Carry on" on the home screen
    })
  );
  if (!s.over && can("concede", s)) {
    const giveUp = (p) => () =>
      confirmSheet(`${n[p]} gives up this game?`, `${n[1 - p]} wins game ${session.match.frames.length}. The scores so far are kept.`, "Give up", () => act({ t: "concede", who: p }));
    if (!shared) items.push(h("div", { class: "row" }, [0, 1].map((p) => btn(`${n[p]} gives up`, giveUp(p)))));
    else items.push(btn("Give up this game", giveUp(session.seat)));
  }
  if (!shared) {
    items.push(
      btn("Restart this game", () => confirmSheet("Restart this game?", "Both scores for this game go back to 0 and it starts again from the break. Earlier games are kept.", "Restart game", () => restartLocal(false))),
      btn("Start the match over", () => confirmSheet("Start the match over?", "Every game is cleared and games won go back to 0–0. Same players, same settings.", "Start over", () => restartLocal(true))),
      btn("Delete this match", () => confirmSheet("Delete this match?", "Every game and score on this phone goes, and you're back at the start.", "Delete", () => (deleteLocal(gameOf(session.match)), nav.home())), "btn warn")
    );
  } else if (other && session.match.frames[session.match.frames.length - 1].ask) {
    items.push(h("p", { class: "note", text: "There's a restart request on the game screen: answer it there." }));
  } else if (other) {
    const ask = (all) => () => {
      closeSheet();
      act(all ? { t: "restart", all: true } : { t: "restart" });
      toast(`Asked ${other} to agree`);
    };
    items.push(
      h("p", { class: "note", text: `Restarting wipes ${other}'s score too, so ${other} has to agree on their phone.` }),
      btn(`Restart this game (asks ${other})`, ask(false)),
      btn(`Start the match over (asks ${other})`, ask(true))
    );
  }
  if (shared && session.seat !== null)
    items.push(
      btn("Remove it from this phone", () =>
        confirmSheet("Remove this shared game?", "It's taken off this phone and you lose your seat in it. The other side keeps their copy.", "Remove", () => {
          forgetSeat(session.id);
          nav.home();
        }), "btn warn")
    );
  openSheet(shared ? "Shared game" : "Game", ...items);
}

function shareSoFar(ui) {
  const n = names();
  const won = gamesWon(session.match);
  shareCard({ game: ui.label, title: `${n[0]} v ${n[1]}`, score: `${won[0]}–${won[1]}`, lines: ["Games won so far"] });
}

/* ---------------- switches ---------------- */

/** An on/off switch that reads and writes its setting when tapped. */
function toggle(label, get, set) {
  const el = h(
    "button",
    {
      type: "button",
      class: "btn toggle",
      role: "switch",
      "aria-checked": String(get()),
      on: {
        click: () => {
          set(!get());
          el.setAttribute("aria-checked", String(get()));
        },
      },
    },
    h("span", { text: label }),
    h("span", { class: "switch", "aria-hidden": "true" })
  );
  return el;
}

function settings() {
  const light = () => document.documentElement.dataset.theme === "light";
  return [
    toggle("Click sounds", () => soundSettings().clicks, (on) => setSound({ clicks: on })),
    canSpeak()
      ? toggle("Spoken prompts (whose turn, what's on)", () => soundSettings().voice, (on) => {
          setSound({ voice: on });
          if (on) sayNow(gameUI().announce(state()) || "Spoken prompts on.");
        })
      : null,
    toggle("Light theme", light, setTheme),
  ].filter(Boolean);
}

export function setTheme(light) {
  store.writeText(store.KEYS.theme, light ? "light" : null);
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f6f5f1" : "#131a17");
}
