// The two games this app knows, each with its own rules engine and its own screens
// (js/snooker/*, js/pool/*). Shared screens ask this registry for the game in front of them.

import snooker from "./snooker/ui.js";
import pool from "./pool/ui.js";
import { gameOf } from "./core/match.js";
import { session } from "./core/session.js";
import * as store from "./core/store.js";

export const GAMES = { snooker, pool };

/** The game picked on this phone (null on the very first start). */
export function pickedGame() {
  const g = store.readText(store.KEYS.game); // a plain string, as earlier versions saved it
  return g === "pool" || g === "snooker" ? g : null;
}
export const pickGame = (game) => store.writeText(store.KEYS.game, game);

/** The screens for the match being played, or for the game picked on the home screen. */
export const gameUI = () => GAMES[session.match ? gameOf(session.match) : pickedGame() || "snooker"];
