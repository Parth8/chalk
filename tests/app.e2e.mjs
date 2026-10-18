// Browser tests: a game on one phone, and a shared game on two phones talking to the real
// Worker code (run in-process on an in-memory database, no network).
//   python3 -m http.server 8765 &
//   NODE_PATH=$(npm root -g) node tests/app.e2e.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import worker from "../worker/worker.js";
import { FakeD1 } from "./helpers/d1.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const SITE = process.env.SITE || "http://localhost:8765/";
const API = "https://snooker-api.8parthaggarwal1999.workers.dev";
const env = { DB: new FakeD1(), ALLOWED_ORIGINS: new URL(SITE).origin };

const browser = await chromium.launch();
let posts = 0;
const errors = [];

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const net = { down: false, fail: 0 }; // no signal: every request fails · fail: the next n moves get a 500
  await ctx.route(`${API}/**`, async (route) => {
    if (net.down) return route.abort("internetdisconnected");
    if (net.fail && route.request().method() === "POST") {
      net.fail--;
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"server_error","message":"Something went wrong. Try again."}' });
    }
    const req = route.request();
    // like a real phone signal: moves take a while, and a later one can overtake an earlier one
    if (req.method() === "POST") await new Promise((r) => setTimeout(r, (posts++ % 2 ? 40 : 450)));
    const res = await worker.fetch(
      new Request(req.url(), { method: req.method(), headers: { ...req.headers(), "CF-Connecting-IP": "10.0.0.1" }, body: req.postData() || undefined }),
      env,
      { waitUntil() {} }
    );
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  const page = await ctx.newPage();
  page.failNext = (n) => (net.fail = n);
  page.signal = async (on) => {
    net.down = !on;
    await ctx.setOffline(!on);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return page;
}

/** First start on a fresh phone: pick the game. */
const pick = async (page, game) => {
  await page.waitForSelector("#view-pick:not([hidden])");
  await page.click(`#view-pick [data-game="${game}"]`);
  await page.waitForSelector("#view-home:not([hidden])");
};
/** The first game of each kind on a phone shows a walkthrough: skip it (one test goes through it). */
const skipTour = async (page) => {
  await page.waitForTimeout(50);
  if (await page.locator("#coach").count()) await page.click('#coach button:has-text("Skip")');
};
const racked = async (page) => {
  await page.waitForSelector("#sheet >> text=rack the balls");
  await page.click('#sheet button:has-text("The balls are racked")');
  await skipTour(page);
};
const tableReady = async (page) => {
  await page.waitForSelector("#sheet >> text=set up the table");
  await page.click('#sheet button:has-text("The table is ready")');
  await skipTour(page);
};
const spotted = async (page) => {
  await page.waitForSelector("#sheet >> text=back on the table");
  await page.click("#sheet .btn.primary");
};
// SHOTS=<folder> saves screenshots along the way, for a look at each screen
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
const score = (page, p) => page.locator(".player .p-score").nth(p).textContent();
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    throw err;
  }
};

try {
  /* ---------------- one phone ---------------- */
  const p = await phone();
  await p.goto(SITE);

  await step("first start: pick snooker, then start a game on this phone", async () => {
    await pick(p, "snooker");
    assert.equal(await p.locator("#reds-block").isVisible(), true);
    await p.click("#start-local");
    await p.fill("input[name=p0]", "Parth");
    await p.fill("input[name=p1]", "Rohan");
    await p.click('#break-pick [data-b="0"]');
    await p.click("#local-form button[type=submit]");
    await p.waitForSelector("#view-game:not([hidden])");
    // a beginner is shown how to set the table up, and can't start until they say it's done
    assert.match(await p.textContent("#sheet"), /Game 1: set up the table/);
    assert.match(await p.textContent("#sheet"), /Parth breaks first/);
    assert.equal(await p.locator("#sheet .close").count(), 0, "no way round it but the button");
    await p.click("#scrim", { position: { x: 10, y: 10 }, force: true });
    assert.equal(await p.locator("#sheet").isVisible(), true, "tapping outside doesn't skip it");
    await p.click('#sheet button:has-text("The table is ready")');
    assert.match(await p.textContent("#guide"), /break-off/i);
    assert.match(await p.textContent("#frame-tag"), /Game 1/);
  });

  await step("the first game shows a walkthrough of the screen, once", async () => {
    await p.waitForSelector("#coach");
    assert.match(await p.textContent("#coach"), /1 of 8\s*The score/);
    await p.click('#coach button:has-text("Next")');
    assert.match(await p.textContent("#coach"), /What to do now/);
    for (let i = 0; i < 6; i++) await p.click('#coach button:has-text("Next")');
    assert.match(await p.textContent("#coach"), /8 of 8\s*Everything else/);
    await p.click('#coach button:has-text("Let\'s play")');
    assert.equal(await p.locator("#coach").count(), 0);
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("chalk.toured"))), { snooker: true });
  });

  await step("red, then tap a colour once to call it and again when it goes in", async () => {
    await p.click(".pad .red");
    assert.equal(await score(p, 0), "1");
    assert.match(await p.textContent("#guide"), /Call a colour/);
    assert.match(await p.textContent(".pad-hint"), /Tap a colour to call it/);
    await p.click('.pad [data-ball="pink"]');
    assert.equal(await score(p, 0), "1", "the first tap only calls it");
    assert.match(await p.textContent("#guide"), /Going for the pink/);
    assert.equal(await p.textContent('.pad [data-ball="pink"] .tag'), "CALLED");
    // another colour after a call: changing the call, or did that one go in (a foul)?
    await p.click('.pad [data-ball="blue"]');
    assert.match(await p.textContent("#sheet"), /You called the pink/);
    await p.click('#sheet button:has-text("Change my call to the blue")');
    assert.match(await p.textContent("#guide"), /Going for the blue/, "changing your mind changes the call");
    await p.click('.pad [data-ball="pink"]');
    await p.click('#sheet button:has-text("Change my call to the pink")');
    await p.click('.pad [data-ball="pink"]');
    assert.equal(await score(p, 0), "7");
    // the pink must go back before anything else: a pop-up shows where
    assert.match(await p.textContent("#sheet"), /Put the pink back on the table/);
    assert.match(await p.textContent("#sheet"), /halfway between the blue and the far cushion/);
    await p.click('#sheet button:has-text("covered")');
    assert.match(await p.textContent("#sheet"), /the black spot/);
    assert.equal(await p.textContent("#sheet .btn.primary"), "The pink is on the black spot");
    await p.click("#sheet .btn.primary");
    assert.equal(await p.locator("#sheet").isHidden(), true);
  });

  await step("on a red, the white hit a colour first: What happened? says it's a foul and why", async () => {
    await p.click("#btn-foul");
    assert.match(await p.textContent("#sheet"), /You were on a red/);
    assert.match(await p.textContent("#sheet .verdict"), /Not a foul/, "starts from: hit a red, nothing went in");
    await p.click('#sheet .chips >> nth=0 >> button:has-text("Blue")');
    assert.match(await p.textContent("#sheet .verdict"), /Foul: 5 points to Rohan/);
    assert.match(await p.textContent("#sheet .verdict"), /on a red, but the white hit the blue first/);
    assert.match(await p.textContent("#sheet .verdict"), /not ball in hand/);
    await shot(p, "what-happened");
    await p.click('.verdict button:has-text("Give 5 to Rohan")');
    assert.equal(await score(p, 1), "5");
    assert.match(await p.textContent("#alerts"), /Foul by Parth/);
  });

  await step("tapping a colour while on a red asks what happened instead of guessing", async () => {
    await p.click('#alerts button:has-text("plays on")');
    await p.click('.pad [data-ball="green"]');
    assert.match(await p.textContent("#sheet"), /You're on a red/);
    assert.match(await p.textContent("#sheet .verdict"), /Foul: 4 points to Parth/);
    await p.click("#sheet .close");
  });

  await step("missed: nothing went in, turn passes, no points", async () => {
    await p.click("#btn-miss");
    assert.match(await p.locator(".player.at").textContent(), /Parth/);
    assert.equal(await score(p, 1), "5");
  });

  await step("in-off after a red: foul, red stays down, white in hand with the D drawn", async () => {
    await p.click("#btn-foul");
    await p.click('#sheet .chips >> nth=1 >> button:has-text("White")');
    await p.click('#sheet .chips >> nth=1 >> button[aria-label="One more red"]');
    assert.match(await p.textContent("#sheet .verdict"), /Foul: 4 points to Rohan/);
    assert.match(await p.textContent("#sheet .verdict"), /the red stays down/);
    await p.click(".verdict .btn");
    assert.equal(await score(p, 1), "9");
    assert.match(await p.textContent(".pad .red"), /× 13/);
    assert.match(await p.textContent("#alerts"), /White in hand: anywhere in the D/);
    assert.equal(await p.locator("#guide svg.table .d-hot").count(), 1, "the D is drawn next to what's on");
    await p.click("#btn-foul");
    await p.click("#sheet details.more summary");
    assert.equal(await p.locator('.choice:has-text("outside the D")').count(), 1, "offered with the white in hand");
    await p.click("#sheet .close");
  });

  await step("free ball: any colour counts as a red", async () => {
    await p.click('#alerts button:has-text("Free ball")');
    await p.click('#sheet button:has-text("Take the free ball")');
    assert.equal(await p.locator(".pad .tag").count(), 6);
    await p.click('.pad [data-ball="green"]');
    assert.equal(await score(p, 1), "10");
    assert.match(await p.textContent("#sheet"), /Put the green back/);
    await p.click('#sheet button:has-text("didn\'t go in (undo)")');
    assert.equal(await score(p, 1), "9");
    assert.equal(await p.locator("#sheet").isHidden(), true);
  });

  await step("two reds in one shot", async () => {
    await p.click(".pad .red");
    assert.match(await p.textContent(".pad .red"), /Another red in, same shot/);
    await p.click(".pad .red");
    assert.equal(await score(p, 1), "11");
    assert.equal(await p.getAttribute(".pad .red", "aria-label"), "Another red went in on the same shot (11 left)");
  });

  await step("after closing the app, home says which game and switching is one tap away", async () => {
    await p.reload();
    assert.match(await p.textContent("#game-label"), /What are you playing\?/);
    assert.equal(await p.getAttribute('#game-pick [data-game="snooker"]', "aria-checked"), "true");
    await p.click('#game-pick [data-game="pool"]');
    assert.equal(await p.getAttribute('#game-pick [data-game="pool"]', "aria-checked"), "true");
    assert.match(await p.textContent("#learn-title"), /New to pool/);
    assert.match(await p.textContent("#resume"), /Carry on: Parth v Rohan\s*Snooker/, "the snooker match is still there to carry on");
    await p.click("#start-local");
    assert.match(await p.textContent("#local-game"), /Playing 8-ball pool/);
    await p.click('#local-form button:has-text("Change game")');
    await p.click('#game-pick [data-game="snooker"]');
  });

  await step("the game survives a reload", async () => {
    await p.click("#resume .resume-row .btn.big");
    assert.equal(await score(p, 0), "7");
    assert.equal(await score(p, 1), "11");
  });

  await step("quick answers are worked out for the player at the table", async () => {
    await p.click(".ask-btn");
    await p.fill(".ask-input", "what if I pot the cue ball");
    const first = p.locator("#sheet details.qa").first();
    assert.match(await first.textContent(), /pot the white/);
    assert.match(await first.textContent(), /Parth\s*gets/);
    await p.fill(".ask-input", "If I call a coloured ball, can I pot it by hitting a red ball");
    assert.match(await p.locator("#sheet details.qa").first().textContent(), /must hit the colour you called first/);
    await p.fill(".ask-input", "reset the game");
    assert.match(await p.locator("#sheet details.qa").first().textContent(), /Restart this game/);
    await p.fill(".ask-input", "what is a frame");
    assert.match(await p.locator("#sheet details.qa").first().textContent(), /one game/);
    await p.click("#sheet .close");
  });

  await step("the phone's Back button comes home (the match stays saved), and a broken link says so", async () => {
    await p.goBack();
    await p.waitForSelector("#view-home:not([hidden])");
    await p.click("#resume .resume-row .btn.big");
    await p.waitForSelector("#view-game:not([hidden])");
    assert.equal(await score(p, 1), "11");
    const bad = await phone();
    await bad.goto(`${SITE}?g=abc`);
    await bad.waitForSelector("#view-join:not([hidden])");
    assert.match(await bad.textContent("#join-card"), /doesn't look right/);
    await bad.close();
  });

  await step("restart the game, start the match over, delete it", async () => {
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Restart this game")');
    await p.click('#sheet button:has-text("Keep it")');
    assert.equal(await score(p, 1), "11", "keep it changes nothing");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Restart this game")');
    await p.click('#sheet button:has-text("Restart game")');
    await tableReady(p);
    assert.equal(await score(p, 0), "0");
    assert.equal(await score(p, 1), "0");
    assert.match(await p.textContent("#guide"), /break-off/i);
    await p.click(".pad .red");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Start the match over")');
    await p.click('#sheet button:has-text("Start over")');
    await tableReady(p);
    assert.equal(await score(p, 0), "0");
    // finishing a game: "game 2", the other player breaks, set the table again
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Rohan gives up")');
    await p.click('#sheet .btn.warn:has-text("Give up")');
    assert.match(await p.textContent("#guide"), /Parth wins/);
    assert.match(await p.textContent(".players .frames"), /1–0\s*GAMES WON/);
    await p.click('#guide button:has-text("Play game 2 · Rohan breaks")');
    await tableReady(p);
    assert.match(await p.textContent("#frame-tag"), /Game 2/);
    await p.click("#frame-tag .frame-help");
    assert.match(await p.textContent("#sheet"), /snooker's word for one game/);
    await p.click("#sheet .close");
    // dark by default, light on request, remembered
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme || "dark"), "dark");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Light theme")');
    await p.reload();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), "light");
    await p.click("#resume .resume-row .btn.big");
    await tableReady(p); // no shot played in game 2 yet, so it asks again
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Light theme")');
    assert.equal(await p.getAttribute('#sheet button:has-text("Light theme")', "aria-checked"), "false", "the switch shows it's off");
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme || "dark"), "dark");
    await p.click("#sheet .close");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Delete this match")');
    await p.click('#sheet .btn.warn:has-text("Delete")');
    await p.waitForSelector("#view-home:not([hidden])");
    assert.equal(await p.locator("#resume").isHidden(), true, "nothing left to carry on");
  });

  await step("doubles, best of 3, and a coin toss for the break", async () => {
    await p.click('#target-pick [data-target="2"]');
    await p.click("#start-local");
    await p.click('#side-pick [data-sides="2"]');
    await p.fill("input[name=t0]", "Pinks");
    await p.fill("input[name=t0a]", "Ann");
    await p.fill("input[name=t0b]", "Bea");
    await p.fill("input[name=t1a]", "Cal");
    await p.fill("input[name=t1b]", "Dev");
    assert.equal(await p.textContent('#break-pick [data-b="1"]'), "Cal & Dev", "no team name: the players' names");
    await p.click('#break-pick [data-b="toss"]');
    await p.click("#local-form button[type=submit]");
    assert.match(await p.textContent("#sheet"), /Heads\s*Pinks/);
    await p.click('#sheet button:has-text("Toss the coin")');
    await p.waitForSelector("#sheet .toss-call");
    assert.match(await p.textContent("#sheet .toss-call"), /^(Heads! Pinks|Tails! Cal & Dev) wins the toss\.$/);
    await p.click('#sheet .toss-result button:has-text("Pinks breaks")'); // the winner's choice, or "instead"
    await p.waitForSelector("#sheet >> text=set up the table");
    assert.match(await p.textContent("#sheet"), /Ann breaks first/);
    await tableReady(p);
    assert.match(await p.textContent("#frame-tag"), /best of 3/);
    assert.match(await p.textContent(".players .frames"), /0–0\s*FIRST TO 2/);
    assert.match(await p.textContent("#standing"), /first to 2 games/);
    assert.match(await p.textContent(".player.at"), /Ann to play/);
    assert.match(await p.textContent("#guide"), /Ann · break-off/);
    await p.click("#btn-miss");
    assert.match(await p.textContent(".player.at"), /Cal to play/, "then the other team");
    await p.click("#btn-miss");
    assert.match(await p.textContent(".player.at"), /Bea to play/, "then Ann's partner");
  });

  await step("spoken prompts say who's up and what's on", async () => {
    await p.evaluate(() => {
      window.said = [];
      speechSynthesis.speak = (u) => window.said.push(u.text);
    });
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Spoken prompts")');
    await p.click("#sheet .close");
    await p.click("#btn-miss");
    await p.click(".pad .red");
    assert.deepEqual(await p.evaluate(() => window.said), ["Bea, pot a red.", "Dev, pot a red.", "Dev, call a colour."]);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("chalk.sound")).voice), true);
  });

  await step("winning the match: no game after it, and a picture of the result to share", async () => {
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Cal & Dev gives up")');
    await p.click('#sheet .btn.warn:has-text("Give up")');
    assert.match(await p.textContent("#guide"), /Pinks wins/);
    await p.click('#guide button:has-text("Play game 2 · Cal breaks")'); // the other team's turn to break
    await tableReady(p);
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Cal & Dev gives up")');
    await p.click('#sheet .btn.warn:has-text("Give up")');
    assert.match(await p.textContent("#guide"), /Pinks wins the match, 2–0/);
    assert.equal(await p.locator('#guide button:has-text("Play game")').count(), 0);
    const [file] = await Promise.all([p.waitForEvent("download"), p.click('#guide button:has-text("Share the result")')]);
    assert.equal(file.suggestedFilename(), "chalk-result.png");
    await shot(p, "match-over");
    await p.click('#guide button:has-text("Play another match")');
    await tableReady(p);
    assert.match(await p.textContent(".players .frames"), /0–0/);
  });

  await step("menu: a coin toss any time, and the cue technique basics", async () => {
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Toss a coin")');
    await p.click('#sheet button:has-text("Toss the coin")');
    await p.waitForSelector("#sheet .toss-call");
    await p.click("#sheet .close");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Switch to 8-ball pool")');
    await p.waitForSelector("#view-home:not([hidden])");
    assert.equal(await p.getAttribute('#game-pick [data-game="pool"]', "aria-checked"), "true");
    await p.click('#resume button:has-text("Carry on: Pinks v Cal & Dev")');
    await tableReady(p); // no shot played yet in this game, so the table is set up first
    assert.match(await p.textContent("#frame-tag"), /15 reds/, "back in the snooker match");
    await p.click('[data-open="menu"]');
    await p.click('#sheet button:has-text("Holding and aiming the cue")');
    assert.match(await p.textContent("#sheet"), /1\. Stand steady/);
    assert.equal(await p.locator("#sheet svg.tech-art").count(), 1);
    for (let i = 0; i < 6; i++) await p.click('#sheet button:has-text("Next")');
    assert.match(await p.textContent("#sheet"), /7\. Can't reach\? Use the rest/);
    await p.click('#sheet button:has-text("Got it")');
    assert.equal(await p.locator("#sheet").isHidden(), true);
  });

  /* ---------------- two phones ---------------- */
  const a = await phone();
  const b = await phone();
  let link;

  await step("start a shared game and get a link", async () => {
    await a.goto(SITE);
    await pick(a, "snooker");
    await a.click('#reds-pick [data-reds="6"]');
    await a.click("#start-online");
    await a.waitForSelector("#join-card input[name=name]");
    await a.fill("#join-card input[name=name]", "Asha");
    await a.click('#join-card button[type=submit]');
    await a.waitForSelector("text=Waiting for the other side");
    link = await a.textContent(".share-link");
    assert.equal(await a.locator("#join-card svg.qr").count(), 1, "a QR code for the phone next to you");
    await shot(a, "lobby");
    assert.match(link, /\?g=[a-z2-9]{10}$/);
  });

  await step("the other side opens the link, types a name and both phones start", async () => {
    await b.goto(link);
    assert.match(await b.textContent("#join-card"), /Asha invited you/);
    await shot(b, "join");
    await b.fill("#join-card input[name=name]", "Team Ben");
    await b.click('#join-card button[type=submit]');
    await b.waitForSelector("#view-game:not([hidden])");
    await a.waitForSelector("#view-game:not([hidden])", { timeout: 8000 });
    await tableReady(a);
    await tableReady(b);
    assert.match(await a.textContent("#frame-tag"), /6 reds/);
  });

  await step("only the side at the table can tap; the other phone follows live", async () => {
    const aAt = (await a.locator(".player.at .p-name").textContent()).includes("Asha");
    const [mine, theirs] = aAt ? [a, b] : [b, a];
    const me = aAt ? 0 : 1;
    assert.equal(await theirs.locator(".pad .red").isDisabled(), true);
    assert.equal(await theirs.locator("#btn-foul").isDisabled(), true);
    assert.equal(await mine.locator(".pad .red").isDisabled(), false);
    // a quick burst of taps over a slow, out-of-order network still lands in order
    await mine.click(".pad .red");
    await mine.click('.pad [data-ball="black"]'); // call
    await mine.click('.pad [data-ball="black"]'); // potted
    await spotted(mine); // only the phone at the table is asked to put it back
    await theirs.waitForSelector("#alerts >> text=Put the black back", { timeout: 8000 }); // the other phone just sees a note
    assert.equal(await theirs.locator("#sheet").isHidden(), true, "and no pop-up");
    await mine.click(".pad .red");
    await mine.click('.pad [data-ball="pink"]');
    await theirs.waitForSelector("#guide >> text=Going for the pink", { timeout: 8000 }); // the call shows on the other phone
    await mine.click('.pad [data-ball="pink"]');
    await spotted(mine);
    assert.equal(await score(mine, me), "15");
    await theirs.waitForFunction((p) => document.querySelectorAll(".player .p-score")[p].textContent === "15", me, { timeout: 8000 });
    await mine.waitForFunction(() => !document.querySelector("#toast").classList.contains("show") || !/fit|changed/.test(document.querySelector("#toast").textContent));
    assert.equal(await score(mine, me), "15", "nothing was rolled back");
    assert.equal(await theirs.locator("#btn-undo").isDisabled(), true, "can't undo the other side's pot");
    await mine.waitForTimeout(300);
    await shot(mine, "shared-mine");
    await shot(theirs, "shared-theirs");
    await mine.click("#btn-miss");
    await theirs.waitForFunction(() => !document.querySelector(".pad .red").disabled, null, { timeout: 8000 });
    assert.equal(await mine.locator(".pad .red").isDisabled(), true);
  });

  await step("no signal: taps still show, wait on the phone, and go when it's back", async () => {
    const [mine, theirs] = (await a.locator(".pad .red").isDisabled()) ? [b, a] : [a, b];
    const me = mine === a ? 0 : 1;
    const before = Number(await score(mine, me));
    await mine.signal(false);
    await mine.click(".pad .red");
    assert.equal(await score(mine, me), String(before + 1), "shows at once");
    await mine.waitForSelector("#frame-tag >> text=offline · 1 waiting to send", { timeout: 12000 });
    await mine.click("#btn-miss");
    await mine.waitForSelector("#frame-tag >> text=offline · 2 waiting to send", { timeout: 12000 });
    assert.equal(await mine.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("chalk.outbox.")).length), 1, "kept on the phone, even through a reload");
    assert.equal(await score(theirs, me), String(before), "the other phone hasn't had them yet");
    mine.failNext(1); // and the Worker has a hiccup on the first try: the moves wait and go again
    await mine.signal(true);
    await theirs.waitForFunction(([p, n]) => document.querySelectorAll(".player .p-score")[p].textContent === n, [me, String(before + 1)], { timeout: 20000 });
    await theirs.waitForFunction(() => !document.querySelector(".pad .red").disabled, null, { timeout: 8000 });
    await mine.waitForFunction(() => document.querySelector("#frame-tag .live").textContent === "live", null, { timeout: 8000 });
    assert.equal(await mine.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("chalk.outbox.")).length), 0);
  });

  await step("restarting a shared frame needs the other side to agree", async () => {
    await a.click('[data-open="menu"]');
    await a.click('#sheet button:has-text("Restart this game")');
    await b.waitForSelector("#alerts >> text=Asha wants to restart this game", { timeout: 8000 });
    assert.notEqual(await score(a, 0) + await score(a, 1), "00", "nothing wiped yet");
    await b.click('#alerts button:has-text("Agree")');
    await a.waitForFunction(() => [...document.querySelectorAll(".player .p-score")].every((e) => e.textContent === "0"), null, { timeout: 8000 });
    await tableReady(a); // a fresh game: set the table up again
    await tableReady(b);
  });

  await step("someone with the link after both joined can only watch", async () => {
    const c = await phone();
    await c.goto(link);
    await c.waitForSelector("#view-game:not([hidden])");
    assert.match(await c.textContent("#frame-tag"), /watching/);
    assert.equal(await c.locator("#btn-miss").isDisabled(), true);
  });

  /* ---------------- 8-ball pool ---------------- */
  const q = await phone();
  await q.goto(SITE);
  const pscore = (p) => q.locator(".player .p-score").nth(p).textContent();

  await step("pool: pick 8-ball, rack the balls before the break", async () => {
    await pick(q, "pool");
    assert.match(await q.textContent("#learn-title"), /New to pool/);
    assert.equal(await q.locator("#reds-block").isHidden(), true, "no reds in pool");
    await q.click("#start-local");
    await q.fill("input[name=p0]", "Asha");
    await q.fill("input[name=p1]", "Ben");
    await q.click('#break-pick [data-b="0"]');
    await q.click("#local-form button[type=submit]");
    assert.match(await q.textContent("#sheet"), /Game 1: rack the balls/);
    assert.match(await q.textContent("#sheet"), /8 in the middle of the third row/);
    await racked(q);
    assert.match(await q.textContent("#frame-tag"), /8-ball/);
    assert.match(await q.textContent("#guide"), /Break/);
    assert.match(await q.textContent("#btn-miss"), /Log the break/);
  });

  await step("pool: an illegal break lets the other player choose; a re-rack asks to rack again", async () => {
    await q.click("#btn-miss");
    await q.click('#sheet h3:has-text("4 balls") + .chips button:has-text("No")');
    assert.match(await q.textContent("#sheet .verdict"), /Ben chooses what happens next/);
    assert.match(await q.textContent("#sheet .verdict"), /illegal break/);
    await q.click("#sheet .verdict .btn");
    assert.match(await q.textContent("#guide"), /Illegal break/);
    assert.equal(await q.locator(".pball[data-n='1']").isDisabled(), true, "nothing to tap until Ben chooses");
    await q.click('#guide button:has-text("Re-rack, Asha breaks again")');
    await racked(q);
  });

  await step("pool: a good break keeps the breaker on; the first ball potted decides the groups", async () => {
    await q.click("#btn-miss");
    await q.click('#sheet .chips >> nth=0 >> button:has(.pdot[data-n="3"])');
    await q.click('#sheet .chips >> nth=0 >> button:has(.pdot[data-n="12"])');
    assert.match(await q.textContent("#sheet .verdict"), /Fair: Asha keeps going/);
    await q.click("#sheet .verdict .btn");
    assert.match(await q.textContent("#guide"), /Open table/);
    await q.click('.pball[data-n="5"]');
    assert.equal(await pscore(0), "5", "Asha has 5 solids left: 1, 2, 4, 6, 7 (the 3 and 5 are down)");
    assert.equal(await pscore(1), "6");
    assert.match(await q.textContent("#guide"), /You're solids/);
  });

  await step("pool: hitting the other group first is a foul: ball in hand anywhere", async () => {
    await q.click("#btn-foul");
    await q.click('#sheet .chips >> nth=0 >> button:has-text("A stripe")');
    assert.match(await q.textContent("#sheet .verdict"), /Foul: ball in hand for Ben/);
    assert.match(await q.textContent("#sheet .verdict"), /hit a stripe first/);
    await q.click("#sheet .verdict .btn");
    assert.match(await q.textContent("#guide"), /Ball in hand: put the white anywhere on the table/);
    assert.match(await q.locator(".player.at").textContent(), /Ben/);
  });

  await step("pool: the other player's ball, a miss, then clearing to the 8 and winning", async () => {
    await q.click('.pball[data-n="9"]');
    assert.equal(await pscore(1), "5");
    await q.click("#btn-miss");
    for (const n of [1, 2, 4, 6, 7]) await q.click(`.pball[data-n="${n}"]`);
    assert.match(await q.textContent("#guide"), /Pot the 8 to win/);
    await q.click('.pball[data-n="8"]');
    // straight after the 7: was it the same shot? (that would lose: the 8 must be the last ball)
    assert.match(await q.textContent("#sheet"), /same shot/);
    await q.click('#sheet button:has-text("A new shot")');
    assert.match(await q.textContent("#sheet"), /Did it go in the pocket/);
    await q.click('#sheet button:has-text("Yes: Asha wins")');
    assert.match(await q.textContent("#guide"), /Asha wins/);
    assert.match(await q.textContent(".players .frames"), /1–0/);
    await q.click('#guide button:has-text("Play game 2 · Ben breaks")');
    await racked(q);
  });

  await step("pool: the 8 too early loses, with the reason", async () => {
    await q.click("#btn-miss");
    await q.click('#sheet .chips >> nth=0 >> button:has(.pdot[data-n="2"])');
    await q.click("#sheet .verdict .btn"); // Ben broke and potted the 2: still open
    await q.click('.pball[data-n="8"]');
    assert.match(await q.textContent("#sheet"), /The 8 isn't yours to pot yet/);
    assert.match(await q.textContent("#sheet .verdict"), /Ben loses this game/);
    await q.click("#sheet .close");
  });

  await step("pool: quick answers are pool answers", async () => {
    await q.click(".ask-btn");
    await q.fill(".ask-input", "what if I scratch on the 8");
    assert.match(await q.locator("#sheet details.qa").first().textContent(), /scratch while shooting at the 8/);
    await q.click("#sheet .close");
  });

  await step("pool: a shared 8-ball game, each side logs its own shots", async () => {
    const x = await phone();
    const y = await phone();
    await x.goto(SITE);
    await pick(x, "pool");
    await x.click("#start-online");
    await x.fill("#join-card input[name=name]", "Asha");
    await x.click("#join-card button[type=submit]");
    await x.waitForSelector("text=Waiting for the other side");
    assert.match(await x.textContent("#join-card"), /8-ball pool/);
    const plink = await x.textContent(".share-link");
    await y.goto(plink);
    assert.match(await y.textContent("#join-card"), /8-ball pool/);
    await y.fill("#join-card input[name=name]", "Ben");
    await y.click('#join-card summary:has-text("Playing doubles")');
    await y.fill("#join-card input[name=partner]", "Bo");
    await y.click("#join-card button[type=submit]");
    await y.waitForSelector("#view-game:not([hidden])");
    await x.waitForSelector("#view-game:not([hidden])", { timeout: 8000 });
    await racked(x);
    await racked(y);
    assert.match(await x.textContent("#players"), /Ben & Bo/);
    assert.match(await x.textContent("#players"), /(Ben|Bo) to play|next: Ben/, "the other phone sees who's up in the pair");
    const xBreaks = (await x.locator(".player.at .p-name").textContent()).includes("Asha");
    const [brk, other] = xBreaks ? [x, y] : [y, x];
    assert.equal(await other.locator("#btn-miss").isDisabled(), true);
    await brk.click("#btn-miss");
    await brk.click('#sheet .chips >> nth=0 >> button:has(.pdot[data-n="4"])');
    await brk.click("#sheet .verdict .btn");
    await other.waitForFunction(() => document.querySelector('.pball[data-n="4"]').classList.contains("gone"), null, { timeout: 8000 });
    await brk.click('.pball[data-n="10"]');
    await other.waitForSelector("#guide >> text=stripes", { timeout: 8000 });
  });

  assert.deepEqual(errors, []);
  console.log("all browser tests passed");
} finally {
  await browser.close();
}
