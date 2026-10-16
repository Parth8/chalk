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
const errors = [];

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(`${API}/**`, async (route) => {
    const req = route.request();
    const res = await worker.fetch(
      new Request(req.url(), { method: req.method(), headers: { ...req.headers(), "CF-Connecting-IP": "10.0.0.1" }, body: req.postData() || undefined }),
      env,
      { waitUntil() {} }
    );
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return page;
}

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

  await step("start a game on this phone", async () => {
    await p.click("#start-local");
    await p.fill("input[name=p0]", "Parth");
    await p.fill("input[name=p1]", "Rohan");
    await p.click('#break-pick [data-b="0"]');
    await p.click("#local-form button[type=submit]");
    await p.waitForSelector("#view-game:not([hidden])");
    assert.match(await p.textContent("#guide"), /break-off/i);
  });

  await step("red then pink scores 7 and asks for the pink to be re-spotted", async () => {
    await p.click(".pad .red");
    assert.match(await p.textContent("#guide"), /Now any colour/);
    await p.click('.pad [data-ball="pink"]');
    assert.equal(await score(p, 0), "7");
    assert.match(await p.textContent("#alerts"), /Put the pink back/);
    await p.click('#alerts button:has-text("Spot covered?")');
    assert.match(await p.textContent("#alerts"), /black spot/);
    await p.click('#alerts button:has-text("Done")');
    assert.doesNotMatch(await p.textContent("#alerts"), /Put the pink back/);
  });

  await step("a colour while on a red explains the foul and gives the points to the other side", async () => {
    await p.click('.pad [data-ball="blue"]');
    assert.match(await p.textContent("#sheet"), /You're on a red/);
    await p.click('.verdict button:has-text("Give 5 to Rohan")');
    assert.equal(await score(p, 1), "5");
    assert.match(await p.textContent("#alerts"), /Foul by Parth/);
    assert.match(await p.textContent("#alerts"), /Put the blue back/);
  });

  await step("free ball: any colour counts as a red", async () => {
    await p.click('#alerts button:has-text("Free ball")');
    await p.click('#sheet button:has-text("Take the free ball")');
    assert.equal(await p.locator(".pad .tag").count(), 6);
    await p.click('.pad [data-ball="green"]');
    assert.equal(await score(p, 1), "6");
    assert.match(await p.textContent("#guide"), /Now any colour/);
    await p.click("#btn-undo");
    assert.equal(await score(p, 1), "5");
  });

  await step("two reds in one shot", async () => {
    await p.click(".pad .red"); // still Rohan's free-ball visit after the undo; a red is fine too
    await p.click(".pad .red");
    await p.click('#sheet button:has-text("Yes, same shot")');
    assert.equal(await score(p, 1), "7");
    assert.match(await p.textContent(".pad .red"), /× 12/);
  });

  await step("the game survives a reload", async () => {
    await p.reload();
    await p.click("#resume button");
    assert.equal(await score(p, 0), "7");
    assert.equal(await score(p, 1), "7");
  });

  await step("quick answers are worked out for the player at the table", async () => {
    await p.click(".ask-btn");
    await p.fill(".ask-input", "what if I pot the cue ball");
    const first = p.locator("#sheet details.qa").first();
    assert.match(await first.textContent(), /pot the white/);
    assert.match(await first.textContent(), /Parth\s*gets/);
    await p.fill(".ask-input", "If I call a coloured ball, can I pot it by hitting a red ball");
    assert.match(await p.locator("#sheet details.qa").first().textContent(), /must hit the colour you called first/);
    await p.click("#sheet .close");
  });

  /* ---------------- two phones ---------------- */
  const a = await phone();
  const b = await phone();
  let link;

  await step("start a shared game and get a link", async () => {
    await a.goto(SITE);
    await a.click('#reds-pick [data-reds="6"]');
    await a.click("#start-online");
    await a.waitForSelector("#join-card input[name=name]");
    await a.fill("#join-card input[name=name]", "Asha");
    await a.click('#join-card button[type=submit]');
    await a.waitForSelector("text=Waiting for the other side");
    link = await a.textContent(".share-link");
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
    assert.match(await a.textContent("#frame-tag"), /6 reds/);
  });

  await step("only the side at the table can tap; the other phone follows live", async () => {
    const aAt = (await a.locator(".player.at .p-name").textContent()).includes("Asha");
    const [mine, theirs] = aAt ? [a, b] : [b, a];
    const me = aAt ? 0 : 1;
    assert.equal(await theirs.locator(".pad .red").isDisabled(), true);
    assert.equal(await theirs.locator("#btn-foul").isDisabled(), true);
    assert.equal(await mine.locator(".pad .red").isDisabled(), false);
    await mine.click(".pad .red");
    await mine.click('.pad [data-ball="black"]');
    assert.equal(await score(mine, me), "8");
    await theirs.waitForFunction((p) => document.querySelectorAll(".player .p-score")[p].textContent === "8", me, { timeout: 8000 });
    assert.equal(await theirs.locator("#btn-undo").isDisabled(), true, "can't undo the other side's pot");
    await mine.waitForTimeout(300);
    await shot(mine, "shared-mine");
    await shot(theirs, "shared-theirs");
    await mine.click("#btn-miss");
    await theirs.waitForFunction(() => !document.querySelector(".pad .red").disabled, null, { timeout: 8000 });
    assert.equal(await mine.locator(".pad .red").isDisabled(), true);
  });

  await step("someone with the link after both joined can only watch", async () => {
    const c = await phone();
    await c.goto(link);
    await c.waitForSelector("#view-game:not([hidden])");
    assert.match(await c.textContent("#frame-tag"), /watching/);
    assert.equal(await c.locator("#btn-miss").isDisabled(), true);
  });

  assert.deepEqual(errors, []);
  console.log("all browser tests passed");
} finally {
  await browser.close();
}
