# Snooker

**Tap the ball you potted. The app keeps the score, the order and the rules.**

A light scoreboard for friendly snooker. Tap a ball when it drops and it's added to the shared list of potted balls. The app tells you what's on next, works out fouls, shows where to put a colour back, and answers "what if…?" questions at the table. You can share a link so each side scores from their own phone, or keep score for both players on one phone.

No ads, no sign-ups, no build step.

**Live:** https://parth8.github.io/snooker/

---

## What it does

- **Tap to score.** Big, real-coloured balls. The ones you can legally pot right now are ringed; the rest are dimmed but still tappable, and tapping one explains why it's a foul and what it costs.
- **Guides the order without guessing your shot.** It says "Pot any red", then "Now any colour" (every colour lit, because it's your choice), then "Yellow (2)" and the rest in order once the reds are gone. It never tells you which colour to go for.
- **Fouls in two taps.** Pick what happened (potted the white, hit nothing, hit the wrong ball first, potted a ball that wasn't on, ball off the table, touched/push/jump, 7-pointers). Add anything that went in. The penalty is worked out from the ball on and the balls involved (4 to 7) and goes to the other side. Reds potted on a foul stay down; colours go back.
- **After a foul**, the player coming in chooses: play on, make the offender play again, take a **free ball** if snookered, or **foul and a miss** (balls put back, penalty kept).
- **Put it back here.** When a colour has to be re-spotted, a small top-down table shows its spot. If the spot is covered, tap **Spot covered?** to step through the next free spot by the rules (black, pink, blue, brown, green, yellow), and finally the "as close as you can, towards the top cushion" fallback.
- **White in hand** after an in-off or the white leaving the table: the D is drawn right next to what's on, and the foul sheet offers "played from outside the D". **Re-spotted black** when the scores are level after the last black, with the coin toss.
- **Live standing:** lead, points left on the table, and "needs snookers".
- **Breaks and frames:** current break, best break, frames won, next frame alternates the break.
- **15, 10 or 6 reds**, for full-size and smaller tables.
- **Quick answers.** Over 70 questions players actually ask, worded for your game (names and real points). Type in plain words ("what if I pot the cue ball", "can I pot my colour off a red", "scratch", "spot is taken") or browse. The top of the list changes with the situation: on a colour you see calling questions, after a foul you see free ball and play-again questions.
- **Undo** any tap, one step at a time.
- **Shared games** (below) or **one phone** for both players. One-phone games are saved on the phone and work offline.
- **Add to home screen.** Opens full-screen like an app, keeps the screen awake while you play, and works offline after the first visit. The same add-to-home-screen guide as Track and Shelfie, with picture steps on iPhone, iPad and Mac.

## The rules it knows

Ball values · red then colour while reds remain · two reds in one shot · the colour after the last red · yellow-to-black clearance · nominating (calling) colours, and a foul before calling counts as 7 · penalty = highest of 4, ball on, ball involved (max 7) · the always-7 fouls · in-off and white off the table · ball in hand: when you get it, D only (not the whole baulk area), move it until you play, any direction, a white stopped in the D is not in hand, free ball from in hand only if snookered from everywhere in the D · in-off with your colour, with the last red, on the break · what counts as "off the table" · hitting nothing · wrong ball first · potting a ball not on · balls off the table · touching ball · push and jump shots · reds never come back, colours re-spotted · re-spotting on an occupied spot · free ball (scores as the ball on, re-spotted, can't snooker behind it) · play again · foul and a miss, three-miss rule · needing snookers · end of frame, foul on the last black, re-spotted black · concede · stalemate re-rack · break-off · differences from pool.

Based on the WPBSA Official Rules of Snooker. The rules engine is `js/engine.js`; `tests/engine.test.mjs` covers each rule.

## Shared games

1. Tap **Start a shared game**. You get a link with a random game ID (`…/snooker/?g=k7m2pqx9ra`).
2. Type your name (or a team name). Send the link to the other side.
3. They open it and type theirs. A coin toss picks who breaks, and both phones show the same game.

**Each side can only score its own turns.** The side at the table logs its pots, misses and fouls. After a foul, only the side coming in can choose play on, play again, free ball or put back. You can only undo your own last move, and only concede for yourself. So one side can never add to or take from the other's score. Both phones, and anyone else with the link, see every move live, so everything is in the open.

How it's enforced: joining gives each side a private seat key, kept only on that phone (the Worker stores a SHA-256 hash of it). Every move is sent with that key and checked by the Worker, which replays the game with **the same rules engine as the page** before accepting it. Moves made on an out-of-date view are refused, so two phones can't overwrite each other. Names are cleaned, moves are checked field by field, requests are rate-limited, and only this site's origin may call the API. Games untouched for 30 days are deleted. There are no accounts and nothing else is stored.

Once both sides have joined, anyone else who opens the link can watch but not score.

## Setting up the Worker

The site works without it (one-phone games). Shared games need a Cloudflare Worker with a D1 database. Everything is done in the dashboard, with no CLI:

1. **Storage & Databases → D1 → Create database** → name it `snooker` → Create.
2. **Workers & Pages → Create → Hello World** → name it **`snooker-api`** → Deploy. Then **Edit code** → paste `worker/worker.js` → Deploy.
3. **Settings → Bindings → Add → D1 database**: variable name **`DB`**, database `snooker`.
4. **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `ALLOWED_ORIGINS` | Text | `https://parth8.github.io` (domain only, no path; add `http://localhost:8765` for local testing) |
| `REQUIRE_ORIGIN` | Text | `false` only while testing the API in a browser tab. Remove afterwards. |

5. Check `https://snooker-api.<your-subdomain>.workers.dev/api/health` shows `{"ok":true,"db":true}`. The table creates itself on first use.
6. If your Worker's address isn't `https://snooker-api.8parthaggarwal1999.workers.dev`, change it in **two** places at the top of `index.html`: the `api-base` meta tag and `connect-src` in the security policy.

Optionally add a Rate Limiting binding named `LIMITER`.

**Updating the Worker.** It carries its own copy of the rules engine so it stays one file you can paste. After changing `js/engine.js`, run `npm run worker` to copy it in (a test fails if you forget), then paste `worker/worker.js` again.

### API

| Route | Body | Returns |
|---|---|---|
| `POST /api/games` | `{ reds }` | `{ id, v, game }` |
| `GET /api/games/<id>?v=<n>` | | `{ v, game }`, or `{ v, same: true }` if nothing changed |
| `POST /api/games/<id>/join` | `{ name }` | `{ seat, token, v, game }` |
| `POST /api/games/<id>/act` | `{ token, v, e }` | `{ v, game }` |

`game` is `{ id, reds, players: [name, name], frames: [{ breaker, events }] }`. A move `e` is one of `pot {ball, extra?}`, `miss`, `foul {kind, hit?, reds?, colours?, white?, called?}`, `again`, `replace`, `free`, `toss {who}`, `concede`, `undo`, `next`. Errors are `{ error, message }`: `not_your_turn` and `not_yours` (403), `stale` (409, with the current game), `illegal` (409), `no_seat` (401), `full` (409), `rate_limited` (429).

Phones check for changes every 2.5 seconds while the app is on screen, and straight away when it comes back.

## Project structure

```
index.html            The views (home, names, join, game), security policy
manifest.webmanifest  Name, icons and full-screen mode for add to home screen
sw.js                 Offline: serves the app from the cache, refreshes it in the background
css/app.css           Tokens, light and dark, components
js/
  engine.js           The rules: state, legal pots, penalties, fouls, free ball, re-spotted black
  rules.js            Quick answers: questions, answers worded for the game, search
  table.js            Top-down table drawing, spots, where a colour goes when its spot is taken
  app.js              Screens, ball pad, foul sheet, re-spot helper, shared-game sync
  api.js              Worker client and the seat keys kept on this phone
  install.js          Add to home screen: which way this browser does it (from Track)
  guide.js            Picture guides for Apple devices (from Track)
worker/worker.js      The Cloudflare Worker (shared games), with a copy of the engine
tools/                build-icons.mjs (app icons), sync-engine.mjs (engine → Worker)
tests/                Rules, answers and Worker tests (node --test), browser tests
icons/                Home-screen and app icons
```

## Running and testing

```sh
python3 -m http.server 8765        # then open http://localhost:8765
npm test                           # rules engine, quick answers, Worker (Node 22+)
NODE_PATH=$(npm root -g) node tests/app.e2e.mjs   # browser tests (needs Playwright and the server above)
```

The browser tests play a game on one phone, then a shared game on two phones with the real Worker code running in-process on an in-memory database.

To publish: Settings → Pages → Deploy from a branch → `main`, `/ (root)`.
