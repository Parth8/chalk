// The 8-ball pool screens: the pad of numbered balls, what's on, ball in hand, the break,
// "What happened?", racking and putting the 8 back. The app shell (app.js) hands in what it
// shares with snooker (sheets, dispatch, who may tap) so this file stays about pool.

import { SOLIDS, STRIPES, ALL, groupOf, groupFor, left, targets, judge, optionsFor, OTHER_FOULS, GROUP_WORDS } from "./pool.js";
import { poolSVG } from "./pool-table.js";

export function poolUI(app) {
  const { h, btn, openSheet, closeSheet, dispatch, toast } = app;
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const rival = (g) => (g === "solids" ? "stripes" : "solids");

  /** A small numbered ball for lists and chips. */
  const pdot = (n, cls = "pdot") => h("span", { class: cls, "data-n": String(n), "data-stripe": n > 8 ? "1" : null, "aria-hidden": "true" }, h("i", { text: String(n) }));
  const white = () => h("span", { class: "pdot", "data-n": "0", "aria-hidden": "true" });
  const pic = (opts) => h("span", { class: "pool-pic", html: poolSVG({ labels: false, ...opts }) });

  const onWords = (s, p = s.turn) => {
    const g = groupFor(s, p);
    if (!g) return "an open table";
    return left(s, p).length ? GROUP_WORDS[g] : "the 8";
  };

  /* ---------------- players and standing ---------------- */

  function playerBody(s, p) {
    const g = groupFor(s, p);
    if (!g) return { big: "–", sub: s.breakShot ? "breaks first" : "open table", dots: null };
    const mine = left(s, p);
    if (!mine.length) return { big: "8", sub: "on the 8", dots: h("span", { class: "mini" }, pdot(8)) };
    return { big: String(mine.length), sub: `${g} left`, dots: h("span", { class: "mini" }, mine.map((n) => pdot(n))) };
  }

  function standing(s, n) {
    if (s.over) return [];
    if (s.breakShot) return [`${n[s.turn]} breaks`];
    if (!s.groups) return ["Open table: nobody has a group yet"];
    return [0, 1].map((p) => `${n[p]}: ${left(s, p).length ? `${s.groups[p]}, ${left(s, p).length} left` : "on the 8"}`).join(" · ");
  }

  /* ---------------- what's on, choices, ball in hand ---------------- */

  function guide(s, n, cards, alerts) {
    const me = n[s.turn];
    const frame = app.frameNo();
    if (s.over) {
      const w = s.winner;
      const how = s.conceded !== null ? `${n[s.conceded]} gave up this game.` : s.how === "potted the 8" ? `${n[w]} potted the 8.` : `${n[1 - w]} ${s.how}, so ${n[w]} wins.`;
      cards.push(
        h(
          "div",
          { class: "g-card", "data-key": `over-${frame}` },
          h("p", { class: "g-kicker", text: `Game ${frame} over` }),
          h("p", { class: "g-title", text: `${n[w]} wins` }),
          h("p", { class: "g-text", text: how }),
          app.can("next", s) ? h("div", { class: "row" }, btn(`Play game ${frame + 1} · ${n[1 - app.match().frames[frame - 1].breaker]} breaks`, () => dispatch({ t: "next" }), "btn primary")) : null
        )
      );
      return;
    }

    if (s.choice) {
      const { kind, by, breaker } = s.choice;
      const mine = app.mode() === "local" || app.online.seat === by;
      const title = {
        "illegal-break": "Illegal break",
        "eight-break": "The 8 went in on the break",
        "eight-break-foul": "The 8 went in, with a foul",
        "break-foul": "Foul on the break",
      }[kind];
      const text = {
        "illegal-break": `Nothing went in and fewer than 4 balls hit a cushion. ${n[by]} chooses what happens:`,
        "eight-break": `That's not a loss. ${n[by]} chooses:`,
        "eight-break-foul": `It isn't a loss on the break. ${n[by]} chooses:`,
        "break-foul": `${n[by]} chooses:`,
      }[kind];
      const label = {
        accept: "Play the table as it is",
        "rerack-me": `Re-rack, ${n[by]} breaks`,
        "rerack-them": `Re-rack, ${n[breaker]} breaks again`,
        spot8: kind === "eight-break" ? "Put the 8 back and carry on" : `Put the 8 back, ${n[by]} plays from behind the line`,
        rebreak: `Re-rack, ${n[by]} breaks`,
        kitchen: "Take the white behind the line",
      };
      cards.push(
        h(
          "div",
          { class: "g-card foul", "data-key": `choice-${app.evKey()}` },
          h("p", { class: "g-kicker", text: `Game ${frame}` }),
          h("p", { class: "g-title", text: title }),
          h("p", { class: "g-text", text: mine ? text : `${text.split(".")[0]}. Waiting for ${n[by]} to choose on their phone.` }),
          mine ? h("div", { class: "choices" }, optionsFor(s).map((o) => btn(label[o], () => dispatch({ t: "choose", opt: o }), "btn"))) : null
        )
      );
      return;
    }

    let kicker = `${me} · at the table`;
    let title;
    let text;
    let extra = null;
    const g = groupFor(s, s.turn);
    if (s.breakShot) {
      kicker = `${me} · the break`;
      title = "Break";
      text = "White anywhere behind the line. Hit the rack hard: pot a ball, or make at least 4 balls hit a cushion. When the balls stop, tap Log the break.";
    } else if (!g) {
      title = "Open table";
      text = "Hit any ball except the 8. The first ball you pot on purpose decides your group: solids (1–7) or stripes (9–15).";
    } else if (left(s, s.turn).length) {
      title = `You're ${g} · ${left(s, s.turn).length} left`;
      text = `Hit one of your ${g} first. Pot one to keep going. Then the 8.`;
      extra = h("div", { class: "mini big" }, left(s, s.turn).map((n2) => pdot(n2)));
    } else {
      title = "Pot the 8 to win";
      text = "Say which pocket first. In a different pocket, or with a foul (like the white going in too), and you lose.";
      extra = h("div", { class: "mini big" }, pdot(8));
    }
    const card = h("div", { class: "g-card", style: "--on: var(--accent)" }, h("p", { class: "g-kicker", text: kicker }), h("p", { class: "g-title", text: title }), h("p", { class: "g-text", text }), extra);
    if (s.inHand) {
      card.append(
        h("p", { class: "g-text" }, h("b", { text: "Ball in hand: " }), s.inHand === "kitchen" ? "put the white anywhere behind the line at your end." : "put the white anywhere on the table.")
      );
      card.classList.add("spot", "in-hand");
      const copy = h("div", { class: "spot-copy" }, ...card.childNodes);
      card.replaceChildren(copy, pic(s.inHand === "kitchen" ? { kitchen: true } : { anywhere: true }));
    }
    if (app.mode() === "online" && !app.can("turn", s)) card.append(h("p", { class: "g-text", text: app.online.seat === null ? `${me}'s phone logs this visit.` : `${me} logs this visit on their phone. You'll see it here live.` }));
    cards.push(card);
  }

  /* ---------------- the pad ---------------- */

  function pad(s) {
    const turn = app.can("turn", s);
    const ok = s.breakShot || s.choice || s.over ? [] : targets(s);
    const ball = (n) => {
      const on = s.table.includes(n);
      return h(
        "button",
        {
          type: "button",
          class: `pball${ok.includes(n) ? " on" : ""}${on ? "" : " gone"}${n === 8 ? " eight" : ""}`,
          "data-n": String(n),
          "data-stripe": n > 8 ? "1" : null,
          "aria-label": on ? `${n} ball${ok.includes(n) ? " (yours)" : ""}: it went in` : `${n} ball, already potted`,
          disabled: !turn || !on || !!s.choice,
          on: { click: () => onBall(n) },
        },
        h("i", { text: String(n) })
      );
    };
    const out = [h("div", { class: "prow" }, SOLIDS.map(ball)), h("div", { class: "prow" }, STRIPES.map(ball)), h("div", { class: "prow eight-row" }, ball(8))];
    if (turn && !s.choice) out.push(h("p", { class: "pad-hint", text: hint(s) }));
    return out;
  }

  function hint(s) {
    if (s.breakShot) return "After the break, tap Log the break (or a ball that went in).";
    const g = groupFor(s, s.turn);
    if (!g) return "Potted a ball on purpose? Tap it. Nothing went in? Missed.";
    if (!left(s, s.turn).length) return "The 8 went in? Tap it. Didn't? Missed.";
    return `One of your ${g} went in? Tap it. Nothing went in? Missed.`;
  }

  function onBall(n) {
    const s = app.state();
    if (!app.can("turn", s) || s.choice || !s.table.includes(n)) return;
    if (s.breakShot) return breakSheet([n]);
    const ok = targets(s);
    const g = groupFor(s, s.turn);
    if (n === 8) {
      if (!ok.includes(8)) return shotSheet({ potted: [8] }, `The 8 isn't yours to pot yet (you're on ${onWords(s)}). What happened?`);
      return eightSheet();
    }
    if (!g || groupOf(n) === g) {
      const r = judge(s, { first: n, potted: [n], rail: true });
      dispatch({ t: "shot", first: n, potted: [n], rail: true });
      if (r.assign) toast(`${app.names()[s.turn]} is ${GROUP_WORDS[r.assign]}`);
      return;
    }
    shotSheet({ potted: [n] }, `The ${n} is one of ${app.names()[1 - s.turn]}'s ${rival(g)}. What happened?`);
  }

  function missed() {
    const s = app.state();
    if (s.breakShot) return breakSheet([]);
    const first = targets(s)[0];
    dispatch({ t: "shot", first, potted: [], rail: true });
  }

  /* ---------------- sheets ---------------- */

  function chip(label, pressed, onClick, lead) {
    return h("button", { type: "button", class: `chip${lead ? " ball-chip" : ""}`, "aria-pressed": String(pressed), on: { click: onClick } }, lead, label);
  }

  function verdictBox(s, r, events, n) {
    const me = n[s.turn];
    const opp = n[1 - s.turn];
    const go = (label, cls) =>
      btn(label, () => {
        closeSheet();
        for (const e of events) dispatch(e);
      }, `btn big ${cls}`);
    const reasons = h("ul", { class: "reasons" }, r.reasons.map((x) => h("li", { text: x })));
    if (r.result === "continue") return h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `Fair: ${me} keeps going` }), reasons, go("Carry on", "primary"));
    if (r.result === "pass") return h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: `No foul: ${opp}'s turn` }), reasons, go(`${opp}'s turn`, ""));
    if (r.result === "foul")
      return h(
        "div",
        { class: "verdict foul" },
        h("p", { class: "v-title", text: `Foul: ball in hand for ${opp}` }),
        reasons,
        h("p", { text: r.kitchen ? `${opp} puts the white anywhere behind the line. Balls that went in stay down.` : `${opp} puts the white anywhere on the table. Balls that went in stay down.` }),
        go(`Foul: ${opp} has ball in hand`, "warn")
      );
    if (r.result === "win") return h("div", { class: "verdict ok" }, h("p", { class: "v-title", text: `${me} wins!` }), reasons, go(`${me} wins the game`, "primary"));
    if (r.result === "loss") return h("div", { class: "verdict foul" }, h("p", { class: "v-title", text: `${me} loses this game` }), reasons, go(`${opp} wins the game`, "warn"));
    const who = r.choice === "eight-break" ? me : opp;
    return h("div", { class: "verdict miss" }, h("p", { class: "v-title", text: `${who} chooses what happens next` }), reasons, go("Show the choices", "primary"));
  }

  /** The break: what went in, and (if nothing) whether 4 balls hit a cushion. */
  function breakSheet(prefill = []) {
    const s = app.state();
    const n = app.names();
    const shot = { potted: new Set(prefill), white: false, rail: true, other: null };
    const body = h("div", { class: "shot" });
    const draw = () => {
      const parts = [h("p", { class: "lead-text" }, `${n[s.turn]} broke. Tell me what happened and I'll rule on it.`)];
      const none = !shot.potted.size && !shot.white;
      parts.push(
        h("h3", { text: "1. What went in? (or flew off the table)" }),
        h(
          "div",
          { class: "chips" },
          chip("Nothing", none, () => {
            shot.potted.clear();
            shot.white = false;
            draw();
          }),
          chip("White", shot.white, () => ((shot.white = !shot.white), draw()), white()),
          ALL.filter((x) => s.table.includes(x)).map((x) => chip("", shot.potted.has(x), () => (shot.potted.has(x) ? shot.potted.delete(x) : shot.potted.add(x), draw()), pdot(x, "pdot big")))
        )
      );
      if (!shot.potted.size)
        parts.push(
          h("h3", { text: "2. Did at least 4 balls hit a cushion?" }),
          h("div", { class: "chips" }, chip("Yes", shot.rail, () => ((shot.rail = true), draw())), chip("No", !shot.rail, () => ((shot.rail = false), draw())))
        );
      parts.push(moreFouls(s, shot, draw));
      const e = { t: "shot", potted: [...shot.potted], white: shot.white || undefined, rail: shot.rail, other: shot.other || undefined };
      parts.push(verdictBox(s, judge(s, e), [clean(e)], n));
      body.replaceChildren(...parts);
    };
    draw();
    openSheet("The break", body);
  }

  /** Any other shot: first contact (by group), what went in, cushion, the 8's pocket. */
  function shotSheet(prefill = {}, intro = "") {
    const s = app.state();
    const n = app.names();
    const g = groupFor(s, s.turn);
    const ok = targets(s);
    const on = (x) => s.table.includes(x);
    const kinds = [
      ["solid", "A solid (1–7)", SOLIDS.filter(on)],
      ["stripe", "A stripe (9–15)", STRIPES.filter(on)],
      ["eight", "The 8", [8]],
    ].filter(([, , list]) => list.length);
    const legalKind = (list) => list.some((x) => ok.includes(x));
    const kindOf = (x) => (x === 8 ? "eight" : groupOf(x) === "solids" ? "solid" : "stripe");
    const shot = {
      first: prefill.first ? kindOf(prefill.first) : kinds.find(([, , list]) => legalKind(list))?.[0] || "nothing",
      potted: new Set(prefill.potted || []),
      white: false,
      rail: true,
      eight: "called",
      called: null,
      other: null,
      safety: false,
    };
    const body = h("div", { class: "shot" });
    const draw = () => {
      const parts = [h("p", { class: "lead-text" }, intro || `Tell me what happened and I'll rule on it. ${n[s.turn]} is on ${onWords(s)}.`)];
      parts.push(
        h("h3", { text: "1. What did the white hit first?" }),
        h(
          "div",
          { class: "chips" },
          kinds.map(([k, label, list]) => chip(legalKind(list) ? `${label} · ${g || k === "eight" ? "yours" : "allowed"}` : label, shot.first === k, () => ((shot.first = k), draw()), pdot(list[0], "pdot"))),
          chip("Nothing", shot.first === "nothing", () => ((shot.first = "nothing"), draw()))
        )
      );
      const none = !shot.potted.size && !shot.white;
      parts.push(
        h("h3", { text: "2. What went in? (or flew off the table)" }),
        h(
          "div",
          { class: "chips" },
          chip("Nothing", none, () => {
            shot.potted.clear();
            shot.white = false;
            draw();
          }),
          chip("White", shot.white, () => ((shot.white = !shot.white), draw()), white()),
          ALL.filter(on).map((x) => chip("", shot.potted.has(x), () => (shot.potted.has(x) ? shot.potted.delete(x) : shot.potted.add(x), draw()), pdot(x, "pdot big")))
        )
      );
      if (!shot.potted.size && shot.first !== "nothing")
        parts.push(
          h("h3", { text: "3. After that, did any ball touch a cushion?" }),
          h("div", { class: "chips" }, chip("Yes", shot.rail, () => ((shot.rail = true), draw())), chip("No, nothing did", !shot.rail, () => ((shot.rail = false), draw())))
        );
      if (shot.potted.has(8) && ok.includes(8))
        parts.push(
          h("h3", { text: "Did the 8 go in the pocket you called?" }),
          h("div", { class: "chips" }, chip("Yes", shot.eight === "called", () => ((shot.eight = "called"), draw())), chip("No, another pocket", shot.eight === "wrong", () => ((shot.eight = "wrong"), draw())))
        );
      const groupsIn = new Set([...shot.potted].filter((x) => x !== 8).map(groupOf));
      if (!g && groupsIn.size > 1) {
        const pot = [...shot.potted].filter((x) => x !== 8);
        if (!pot.includes(shot.called)) shot.called = null;
        parts.push(h("h3", { text: "Which ball had you called?" }), h("div", { class: "chips" }, pot.map((x) => chip("", shot.called === x, () => ((shot.called = x), draw()), pdot(x, "pdot big")))));
      }
      parts.push(moreFouls(s, shot, draw, true));

      const firstBall = shot.first === "nothing" ? "nothing" : (kinds.find(([k]) => k === shot.first)?.[2] || [8]).find((x) => ok.includes(x)) ?? kinds.find(([k]) => k === shot.first)[2][0];
      const e = clean({ t: "shot", first: firstBall, potted: [...shot.potted], white: shot.white, rail: shot.rail, other: shot.other, eight: shot.potted.has(8) ? shot.eight : undefined, safety: shot.safety, called: shot.called });
      const r = judge(s, e);
      if (r.needCalled) parts.push(h("div", { class: "verdict" }, h("p", { text: "Pick the ball you'd called." })));
      else parts.push(verdictBox(s, r, [e], n));
      body.replaceChildren(...parts);
    };
    draw();
    openSheet("What happened?", body);
  }

  function moreFouls(s, shot, draw, safety = false) {
    const list = Object.entries(OTHER_FOULS).filter(([k]) => k !== "placement" || s.inHand === "kitchen");
    const d = h(
      "details",
      { class: "more" },
      h("summary", { text: shot.other ? `Also: ${OTHER_FOULS[shot.other].toLowerCase()}` : shot.safety ? "Also: called safety" : "Anything else? (touched a ball, double hit, safety…)" }),
      h(
        "div",
        { class: "choices" },
        list.map(([k, label]) => h("button", { type: "button", class: "choice", "aria-pressed": String(shot.other === k), on: { click: () => ((shot.other = shot.other === k ? null : k), draw()) } }, label)),
        safety ? h("button", { type: "button", class: "choice safe", "aria-pressed": String(shot.safety), on: { click: () => ((shot.safety = !shot.safety), draw()) } }, "I called safety before the shot (not a foul)") : null
      )
    );
    d.open = !!shot.other || !!shot.safety;
    return d;
  }

  /** Only what the shot needs, so stored moves stay small and the Worker accepts them. */
  function clean(e) {
    const out = { t: "shot" };
    if (e.first !== undefined) out.first = e.first;
    out.potted = [...new Set(e.potted)].sort((a, b) => a - b);
    if (e.white) out.white = true;
    out.rail = !!e.rail;
    if (e.other) out.other = e.other;
    if (e.eight) out.eight = e.eight;
    if (e.safety) out.safety = true;
    if (e.called) out.called = e.called;
    return out;
  }

  /** Tapped the 8 when it's the ball on: the pocket decides it. */
  function eightSheet() {
    const s = app.state();
    const n = app.names();
    const pot = (eight) => {
      closeSheet();
      dispatch({ t: "shot", first: 8, potted: [8], rail: true, eight });
    };
    openSheet(
      "The 8 went in!",
      h("p", { class: "lead-text" }, "Did it go in the pocket ", h("b", { text: n[s.turn] }), " called, with nothing else going wrong (the white stayed on the table)?"),
      btn(`Yes: ${n[s.turn]} wins`, () => pot("called"), "btn primary big"),
      btn("No, it went in a different pocket", () => pot("wrong"), "btn big"),
      btn("Something else happened (the white went in…)", () => shotSheet({ first: 8, potted: [8] }), "link")
    );
  }

  /* ---------------- set up, and the 8 back on its spot ---------------- */

  /** Pop-ups that must be done at the table first: { kind, key, open } or null. */
  function gates(s, ui) {
    // racking: at the start of a game, and again after a re-rack
    const key = `${app.mode()}:${app.online.id || "local"}:${app.frameNo()}:${app.evKey()}`;
    if (s.breakShot && !s.choice && !s.over && !ui.setupDone.has(key)) return { kind: "setup", key, open: () => setupSheet(key, ui) };
    if (s.spot8 && ui.spotDone !== app.evKey()) return { kind: "spot", key: `spot-${app.evKey()}`, open: () => spotSheet(ui) };
    return null;
  }

  function setupSheet(key, done) {
    const n = app.names();
    const s = app.state();
    openSheet(
      `Game ${app.frameNo()}: rack the balls`,
      { locked: true, kind: "setup" },
      h("p", { class: "lead-text" }, "Put the balls out like this. ", h("b", { text: `${n[s.turn]} breaks.` })),
      h("div", { class: "table-wrap", html: poolSVG({ rack: true }) }),
      h(
        "ol",
        { class: "steps" },
        h("li", {}, h("span", {}, "Put the triangle's tip on the ", h("b", { text: "foot spot" }), ", the spot at the far end.")),
        h("li", {}, h("span", {}, "Put the ", pdot(8), h("b", { text: "8" }), " in the middle of the third row.")),
        h("li", {}, h("span", {}, "In the two back corners: one ", h("b", { text: "solid" }), " and one ", h("b", { text: "stripe" }), ".")),
        h("li", {}, h("span", {}, "The rest in any order, packed tight. Lift the triangle off carefully.")),
        h("li", {}, h("span", {}, white(), h("b", { text: " White" }), ` anywhere behind the line at your end (the "kitchen"). ${n[s.turn]} hits the rack hard.`))
      ),
      btn("The balls are racked", () => {
        done.setupDone.add(key);
        closeSheet();
        app.render();
      }, "btn primary big"),
      btn("New to pool? How it works", () => app.learn(0), "link")
    );
  }

  function spotSheet(done) {
    openSheet(
      "Put the 8 back on the table",
      { locked: true, kind: "spot" },
      h("p", { class: "lead-text", text: "The 8 goes back on the foot spot, where the tip of the triangle was." }),
      h("div", { class: "table-wrap", html: poolSVG({ spot: true }) }),
      h("p", { class: "lead-text" }, h("b", { text: "If a ball is in the way, put the 8 as close as you can directly behind the spot, towards the far cushion." })),
      btn("The 8 is back on the table", () => {
        done.spotDone = app.evKey();
        closeSheet();
        app.render();
      }, "btn primary big")
    );
  }

  /* ---------------- the shared list ---------------- */

  function logRows(s, n) {
    const rows = [];
    let visit = null;
    const flush = () => visit && (rows.push(visit), (visit = null));
    for (const l of s.log) {
      if (l.t === "shot" && (l.result === "continue" || (l.result === "pass" && l.potted.length && !l.brk)) && !l.white) {
        if (!visit || visit.p !== l.p) {
          flush();
          visit = { p: l.p, balls: [], brk: false };
        }
        visit.balls.push(...l.potted);
        visit.brk ||= l.brk;
        if (l.result === "pass") flush();
        continue;
      }
      flush();
      if (l.t === "shot" && l.result === "pass") continue;
      rows.push(l);
    }
    flush();
    return rows.reverse().map((r) => {
      if (r.balls) return h("li", {}, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, r.brk ? h("small", { text: "break " }) : null, r.balls.map((x) => pdot(x))), h("span", { class: "pts", text: `${r.balls.length}` }));
      if (r.t === "shot" && r.result === "foul") return h("li", { class: "foul" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, `Foul${r.white ? " (white in)" : ""} → ball in hand`, ...r.potted.map((x) => pdot(x))), h("span", { class: "pts", text: "" }));
      if (r.t === "shot" && (r.result === "win" || r.result === "loss")) return h("li", { class: r.result === "loss" ? "foul" : "" }, h("span", { class: "who", text: n[r.p] }), h("span", { class: "balls" }, r.result === "win" ? "Potted the 8: wins" : "Lost on the 8", pdot(8)), h("span", { class: "pts", text: "" }));
      if (r.t === "shot" && r.result === "choice") return h("li", { class: "info", text: `${n[r.p]}'s break: ${r.potted.includes(8) ? "the 8 went in" : "illegal or foul break"}` });
      if (r.t === "choose") {
        const said = { accept: "plays the table as it is", "rerack-me": "re-racks to break", "rerack-them": "re-racks for a re-break", spot8: "puts the 8 back", rebreak: "re-racks to break", kitchen: "takes the white behind the line" }[r.opt];
        return h("li", { class: "info", text: `${n[r.p]} ${said}` });
      }
      if (r.t === "concede") return h("li", { class: "info", text: `${n[r.p]} gave up this game` });
      return null;
    });
  }

  /* ---------------- learn ---------------- */

  const LESSONS = [
    ["The idea", () => [h("p", {}, "Take turns hitting the ", h("b", { text: "white ball" }), " with your cue to knock the numbered balls into the pockets (", h("b", { text: "potting" }), "). There are no points: you win a game by potting the black ", h("b", { text: "8" }), " at the right moment.")]],
    [
      "Solids and stripes",
      () => [
        h("div", { class: "balls-row" }, SOLIDS.map((x) => pdot(x, "pdot big"))),
        h("div", { class: "balls-row" }, STRIPES.map((x) => pdot(x, "pdot big"))),
        h("p", {}, "One player gets the ", h("b", { text: "solids (1–7)" }), ", the other the ", h("b", { text: "stripes (9–15)" }), ". The 8 belongs to nobody."),
      ],
    ],
    ["The break", () => [h("p", {}, "Rack the balls in a triangle, put the white behind the line at your end, and hit the rack hard. Until someone pots a ball on purpose, nobody has a group (an ", h("b", { text: "open table" }), ").")]],
    ["Your turn", () => [h("p", {}, "Hit one of ", h("b", { text: "your own balls first" }), ". Pot one and you keep going. Miss, and it's the other player's turn.")]],
    ["Fouls", () => [h("p", {}, "Hit the wrong ball first, put the white in a pocket, or hit nothing? That's a ", h("b", { text: "foul" }), ": the other player gets ", h("b", { text: "ball in hand" }), " and can put the white anywhere."), h("p", {}, "Not sure? Tap ", h("b", { text: "What happened?" }), " and the app tells you.")]],
    ["The 8 wins (or loses)", () => [h("p", {}, "Once all your balls are down, say which pocket, then pot the 8 to ", h("b", { text: "win" }), "."), h("p", {}, "Pot it early, in the wrong pocket, or with a foul, and you ", h("b", { text: "lose" }), ".")]],
    ["Games", () => [h("p", {}, "Play as many games as you like: the app counts games won, and you take turns to break. People call this game pool, 8-ball or billiards."), h("p", {}, "The app tells you what to do at every step. You just tap what happened.")]],
  ];

  return { pdot, playerBody, standing, guide, pad, onBall, missed, shotSheet, breakSheet, gates, logRows, LESSONS, pic };
}
