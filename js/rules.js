// Quick answers to "what if…?" questions at the table. Each answer is worded for the game in
// front of you: names, the ball on and the actual points. Plain text with **bold**; the app
// escapes it before display, so player names can never inject markup.

import { COLOURS, VALUE, valueOn, remaining, standing, maxBreak } from "./engine.js";

/** What the answers need to know about the game right now (works with no game too). */
export function context(s, players = ["You", "Your opponent"]) {
  if (!s) return { me: "you", opp: "your opponent", phase: "red", reds: 15, onVal: 1, onText: "a red", generic: true };
  const me = players[s.turn] || "you";
  const opp = players[1 - s.turn] || "your opponent";
  const onVal = s.phase === "colour" ? null : valueOn(s);
  const onText = s.phase === "red" ? "a red" : s.phase === "colour" ? "a colour (whichever you call)" : `the ${COLOURS[s.next]}`;
  return { s, me, opp, phase: s.phase, reds: s.reds, onVal, onText, next: COLOURS[s.next], players };
}

/** The penalty, worded: a number when we know the ball on, a range while a colour is still to be called. */
function pen(c, extra = 0) {
  if (c.onVal === null) {
    const n = Math.max(4, extra);
    return n === 7 ? "**7 points**" : `**${n} points**, or the value of the colour you called if that's more (blue 5, pink 6, black 7)`;
  }
  return `**${Math.max(4, c.onVal, extra)} points**`;
}
const spotsBack = "Reds potted on a foul stay down; colours go back on their spots.";

export const TOPICS = ["The white", "Missing", "Calling a colour", "Order of play", "Spots", "Fouls", "Snookers & free ball", "End of frame", "Basics"];

export const QA = [
  /* ---------------- The white ---------------- */
  {
    id: "pot-white",
    topic: "The white",
    q: "What if I pot the white (in-off)?",
    keys: "white cue pot potted in-off inoff scratch pocket sink",
    a: (c) =>
      `Foul. **${c.opp}** gets ${pen(c)}. Nothing you potted on that shot counts. ${spotsBack}\n` +
      `${c.opp} then puts the white **anywhere in the D** and plays, or makes ${c.me} play again from the D.\n` +
      `In the app: tap **Foul → Potted the white**.`,
  },
  {
    id: "red-and-white",
    topic: "The white",
    q: "What if I pot a red and the white goes in too?",
    keys: "red white cue in-off both together same shot scratch pot",
    a: (c) =>
      `Foul: the red doesn't count and **stays down** (reds never come back). **${c.opp}** gets ${pen(c)} and plays with the white in hand in the D.\n` +
      `In the app: **Foul → Potted the white**, and add the red under "Also potted" so the red count stays right.`,
  },
  {
    id: "ball-in-hand",
    topic: "The white",
    q: "Is it ball in hand for my opponent after a foul?",
    keys: "ball in hand foul anywhere place white opponent pool",
    a: (c) =>
      `Only when the white was **potted or left the table**, and even then only **inside the D**, not anywhere like in pool.\n` +
      `After any other foul, ${c.opp} plays the white from where it stopped (or makes ${c.me} play again from there).`,
  },
  {
    id: "place-white",
    topic: "The white",
    q: "Where do I put the white after an in-off?",
    keys: "place white d where put in hand baulk semicircle position",
    show: "d",
    a: () => `Anywhere **inside the D or on its lines**. From there you can play in any direction, even at balls behind the baulk line.`,
  },
  {
    id: "white-off",
    topic: "The white",
    q: "What if the white jumps off the table?",
    keys: "white off table jump floor cushion leave",
    a: (c) => `Same as potting it: foul, **${c.opp}** gets ${pen(c)} and plays with the white in hand in the D.`,
  },
  {
    id: "touching",
    topic: "The white",
    q: "What if the white is touching another ball?",
    keys: "touching touch white resting against ball kissing frozen",
    a: () =>
      `"Touching ball". Play **away** from it without moving it; if it moves, that's a push stroke foul.\n` +
      `• Touching a ball that's **on**: you count as having hit it, so it's no foul if you then hit nothing else.\n` +
      `• Touching a ball that's **not on**: you still have to hit a ball on.`,
  },
  {
    id: "double-hit",
    topic: "The white",
    q: "What if I hit the white twice or push it?",
    keys: "double hit twice push stroke cue stays contact",
    a: (c) => `Foul (a push stroke): ${pen(c)} to ${c.opp}. It's a push if the tip is still on the white when it hits the object ball, or touches the white twice.`,
  },
  {
    id: "jump",
    topic: "The white",
    q: "Can I jump the white over a ball?",
    keys: "jump shot over ball hop lift",
    a: (c) => `No. Jumping over a ball before hitting the ball on is a foul: ${pen(c)} to ${c.opp}. Accidentally bouncing after a fair contact is fine.`,
  },
  {
    id: "miscue",
    topic: "The white",
    q: "Is a miscue a foul?",
    keys: "miscue slip tip skid",
    a: () => `Not on its own. It's only a foul if the white then misses the ball on, hits the wrong ball, or the cue touches it twice.`,
  },

  /* ---------------- Missing ---------------- */
  {
    id: "called-missed",
    topic: "Missing",
    q: "What if I call a colour and don't pot it?",
    keys: "call called colour miss missed not pot didnt fail nominate ball in hand",
    a: (c) =>
      `If the white **hit that colour first**: no foul and no points. Your turn ends and ${c.opp} comes in on ${c.reds > 0 ? "a red" : "the yellow"}. It is **not** ball in hand.\n` +
      `If the white hit a different ball first, or nothing at all, it's a foul: **${c.opp}** gets the value of the colour you called (at least 4).\n` +
      `In the app: tap **Missed** (or **Foul** if it hit the wrong ball).`,
  },
  {
    id: "missed-pot",
    topic: "Missing",
    q: "What if I miss the pot?",
    keys: "miss missed pot fail turn end",
    a: (c) =>
      `As long as the white hit ${c.onText} first, it's no foul: no points, and it's ${c.opp}'s turn from where the balls stopped. Tap **Missed**.`,
  },
  {
    id: "hit-nothing",
    topic: "Missing",
    q: "What if I don't hit any ball?",
    keys: "hit nothing miss missed completely everything all air ball no contact",
    a: (c) =>
      `Foul: ${pen(c)} to **${c.opp}**. ${c.opp} can play from there, or make ${c.me} play again. In matches with a referee it can also be a "foul and a miss", where the balls are put back.`,
  },
  {
    id: "foul-and-miss",
    topic: "Missing",
    q: "What's a 'foul and a miss'?",
    keys: "foul and a miss replace put back referee attempt",
    a: (c) =>
      `If you fail to hit the ball on and didn't make a proper attempt, the referee calls a **miss**. ${c.opp} gets the penalty and can have **the balls put back** and make you play the shot again.\n` +
      `Friendly games usually skip it. In the app, after a foul tap **Miss: put back**.`,
  },
  {
    id: "three-miss",
    topic: "Missing",
    q: "Is there a three-miss rule?",
    keys: "three miss rule 3 times frame lose",
    a: () =>
      `Yes, in refereed play: if you have a **clear sight** of a ball on and miss it three times in a row (each called a miss), you lose the frame. You're warned after the second. It doesn't apply when you're snookered.`,
  },
  {
    id: "snookered-hit",
    topic: "Missing",
    q: "I'm snookered: do I still have to hit the ball on?",
    keys: "snookered must hit ball on escape swerve cushion",
    a: (c) => `Yes. Use cushions or swerve. If you don't hit ${c.onText}, it's a foul: ${pen(c)} to ${c.opp}.`,
  },

  /* ---------------- Calling a colour ---------------- */
  {
    id: "must-call",
    topic: "Calling a colour",
    q: "Do I have to call (nominate) my colour?",
    keys: "call nominate declare colour must have to say",
    a: () =>
      `After potting a red, yes, if it isn't obvious which colour you're playing. The colour you call is the one the white must hit first. A foul before you've called counts as **7**.\n` +
      `In the app, just tap the colour you potted.`,
  },
  {
    id: "pot-via-red",
    topic: "Calling a colour",
    q: "If I call a colour, can I pot it by hitting a red?",
    keys: "call colour pot hitting red first via plant combination off red",
    a: (c) =>
      `No. The white must hit **the colour you called first**. Hitting a red first is a foul: **${c.opp}** gets the value of the called colour (at least 4), the colour goes back on its spot, and nothing scores.`,
  },
  {
    id: "wrong-colour",
    topic: "Calling a colour",
    q: "I called one colour and potted another?",
    keys: "called one colour potted another different wrong colour",
    a: (c) => `Foul. **${c.opp}** gets the **higher** of the two colours' values (at least 4). The potted colour goes back on its spot.`,
  },
  {
    id: "colour-plant",
    topic: "Calling a colour",
    q: "Can I pot a colour by knocking it in with another colour?",
    keys: "plant combination colour into another off set knock via",
    a: () =>
      `No. With a colour on, the white must hit the called colour first and **only that colour** may drop. The one exception is a **free ball**. Reds are different: hitting one red into another is fine.`,
  },
  {
    id: "red-plant",
    topic: "Calling a colour",
    q: "Can I pot a red by hitting another red into it?",
    keys: "red plant combination another red pot",
    a: () => `Yes. When reds are on, any red you pot counts, even through another red.`,
  },
  {
    id: "two-reds",
    topic: "Calling a colour",
    q: "What if I pot two reds in one shot?",
    keys: "two 2 reds both same shot double one stroke",
    a: () => `Both count: **1 point each**. You still get just one colour after. In the app, tap the red twice and confirm "same shot".`,
  },
  {
    id: "red-and-colour",
    topic: "Calling a colour",
    q: "What if a red and a colour go down together?",
    keys: "red and colour together same shot both potted",
    a: (c) =>
      `It's a foul, whichever you were on: only the ball on may drop. **${c.opp}** gets the colour's value (at least 4). The red stays down and the colour goes back on its spot.`,
  },
  {
    id: "call-red",
    topic: "Calling a colour",
    q: "Can I call a red as my 'colour'?",
    keys: "call red as colour nominate red again two reds row",
    a: () => `No. After a red you must play a colour. Playing at reds in two shots in a row is a **7-point foul**.`,
  },
  {
    id: "split",
    topic: "Calling a colour",
    q: "What if the white hits two balls at the same time?",
    keys: "hit two balls same time simultaneously split together",
    a: () =>
      `If one is on and the other isn't, and you can't tell which was first, it's a foul: the higher value, at least 4. If both are on (two reds, say), it's fine.`,
  },

  /* ---------------- Order of play ---------------- */
  {
    id: "order",
    topic: "Order of play",
    q: "What order do I pot the balls?",
    keys: "order sequence how play which next red colour turn",
    a: () =>
      `**Red, colour, red, colour…** Any red, then any colour you call. The colour comes back on its spot.\n` +
      `When the reds are gone: **yellow 2 → green 3 → brown 4 → blue 5 → pink 6 → black 7**, and they stay down.`,
  },
  {
    id: "last-red",
    topic: "Order of play",
    q: "What happens after the last red?",
    keys: "last red final after colour choice",
    a: () =>
      `You still get **one colour of your choice** (it goes back on its spot), then it's the yellow, green and so on in order. If you miss that colour, your opponent starts on the yellow.`,
  },
  {
    id: "out-of-order",
    topic: "Order of play",
    q: "What if I pot a colour out of order at the end?",
    keys: "out of order wrong colour end clearance sequence",
    a: (c) =>
      c.phase === "clear"
        ? `Foul. ${c.next ? `You're on the **${c.next}**, so ` : ""}**${c.opp}** gets the higher of the ball on and the colour you potted (at least 4). That colour goes back on its spot.`
        : `Foul: your opponent gets the higher of the ball on and the colour potted (at least 4). That colour goes back on its spot.`,
  },
  {
    id: "reds-back",
    topic: "Order of play",
    q: "Do reds ever go back on the table?",
    keys: "reds back respot return replaced",
    a: () => `Never: not after a foul, not when one jumps off the table. The only exception is "foul and a miss", when everything is put back as it was.`,
  },
  {
    id: "colours-back",
    topic: "Order of play",
    q: "When do colours go back on their spots?",
    keys: "colours back respot spot return when stay down",
    a: () =>
      `While any reds are left, and for the colour after the last red. Also any colour potted **on a foul** or knocked off the table. In the final yellow-to-black run, legally potted colours stay down.`,
  },

  /* ---------------- Spots ---------------- */
  {
    id: "spots",
    topic: "Spots",
    q: "Where does each colour go?",
    keys: "where spot spots positions colour go place set table",
    show: "table",
    a: () =>
      `Standing at the baulk end (where you break from), along the baulk line: **green left, brown middle, yellow right** ("God Bless You").\n` +
      `**Blue** on the centre spot, **pink** halfway between the blue and the top cushion, **black** near the top cushion. The reds sit in a triangle just behind the pink.`,
  },
  {
    id: "spot-taken",
    topic: "Spots",
    q: "What if a colour's spot is taken?",
    keys: "spot taken occupied covered blocked respot ball in the way",
    a: () =>
      `Put it on the **highest-value spot that's free**: black spot, then pink, blue, brown, green, yellow.\n` +
      `If every spot is taken, place it as near its own spot as possible, towards the top cushion. For pink and black, if that's blocked too, go straight below the spot instead. It mustn't touch another ball.`,
  },
  {
    id: "two-spot",
    topic: "Spots",
    q: "Two colours to put back: which first?",
    keys: "two colours respot order first both",
    a: () => `The **higher-value** one goes back first, so it gets its spot if both want the same one.`,
  },
  {
    id: "setup",
    topic: "Spots",
    q: "How do I set up the table?",
    keys: "set up setup rack triangle start frame arrange",
    show: "table",
    a: (c) =>
      `Reds in a tight triangle with the point just behind the pink (not touching), the base towards the black. Colours on their spots. Break from the D with the white.` +
      (c.s ? ` This frame uses **${c.s.total} reds**.` : ""),
  },

  /* ---------------- Fouls ---------------- */
  {
    id: "foul-value",
    topic: "Fouls",
    q: "How many points is a foul?",
    keys: "foul points penalty value worth how much minimum",
    a: (c) =>
      `The **highest** of: 4, the value of the ball on, and the value of any ball wrongly hit or potted. So it's **4 to 7**, and it goes to your opponent.${c.generic ? "" : ` Right now a foul by ${c.me} is worth at least ${pen(c)}.`}`,
  },
  {
    id: "seven",
    topic: "Fouls",
    q: "Which fouls are always 7 points?",
    keys: "seven 7 points foul always",
    a: () =>
      `• Playing at reds in two shots in a row\n• A foul after potting a red, before calling a colour\n• Using a ball that's off the table for anything (to measure, say)\n• Using anything else to measure gaps\n• Not saying which ball you're on when asked`,
  },
  {
    id: "after-foul",
    topic: "Fouls",
    q: "Who plays after a foul?",
    keys: "who plays after foul next turn choice",
    a: (c) =>
      `The other player (${c.opp}) chooses: **play from where the balls are**, or **make the offender play again**. If the foul left them snookered, they can also take a **free ball**.`,
  },
  {
    id: "play-again",
    topic: "Fouls",
    q: "Can I make my opponent play again after their foul?",
    keys: "make play again opponent foul put back retake",
    a: () => `Yes, you can always ask them to play again from where the balls are (from the D if the white went in). You still keep the penalty points. In the app, tap **Play again** after the foul.`,
  },
  {
    id: "touch-ball",
    topic: "Fouls",
    q: "What if I touch a ball with my hand, cue or clothes?",
    keys: "touch ball hand cue sleeve clothes accidentally move",
    a: (c) => `Foul: ${pen(c)} to ${c.opp} (or the touched ball's value if that's more). Put the ball back where it was.`,
  },
  {
    id: "feet",
    topic: "Fouls",
    q: "Do I need a foot on the floor?",
    keys: "foot feet floor leg sit table",
    a: () => `Yes. Both feet off the floor is a foul. Sitting partly on the edge is fine as long as a foot touches the floor.`,
  },
  {
    id: "moving",
    topic: "Fouls",
    q: "Can I play before the balls stop moving?",
    keys: "balls moving stop rolling still play early",
    a: (c) => `No, that's a foul: ${pen(c)} to ${c.opp}. Wait for every ball to stop.`,
  },
  {
    id: "off-table",
    topic: "Fouls",
    q: "What if a ball jumps off the table?",
    keys: "ball off table jump floor leave",
    a: (c) =>
      `Foul: ${c.opp} gets ${pen(c)}, or the value of the ball that left the table if that's more. A red stays off; a colour goes back on its spot; the white means ball in hand in the D.`,
  },
  {
    id: "out-of-turn",
    topic: "Fouls",
    q: "What if someone plays out of turn?",
    keys: "out of turn wrong player twice",
    a: () => `It's a foul by the player who played, with the usual penalty (at least 4).`,
  },
  {
    id: "potted-on-foul",
    topic: "Fouls",
    q: "Do balls potted on a foul score?",
    keys: "potted foul score count points",
    a: () => `No. Nothing scores on a foul shot. ${spotsBack}`,
  },
  {
    id: "cushion",
    topic: "Fouls",
    q: "Does a ball have to hit a cushion after contact?",
    keys: "cushion rail contact after hit pool rule",
    a: () => `No, that's a pool rule. In snooker you only need to hit the ball on first.`,
  },
  {
    id: "fell-in",
    topic: "Fouls",
    q: "A ball dropped into a pocket on its own?",
    keys: "ball fell dropped pocket itself own edge hanging later",
    a: () => `If it had stopped and then fell without being hit, it's put back where it was, with no penalty. If it was still moving from the shot, it counts as potted.`,
  },

  /* ---------------- Snookers & free ball ---------------- */
  {
    id: "snooker",
    topic: "Snookers & free ball",
    q: "What is a snooker?",
    keys: "what snooker snookered behind blocked",
    a: () => `You're snookered when a ball that's not on blocks a straight line from the white to every ball on. Laying one makes your opponent likely to foul, giving you points.`,
  },
  {
    id: "free-ball",
    topic: "Snookers & free ball",
    q: "What is a free ball?",
    keys: "free ball snookered after foul nominate any",
    a: (c) =>
      `If a foul leaves you **snookered**, you may pick **any colour** to play as if it were the ball on.\n` +
      `It scores the value of the ball on (${c.phase === "clear" ? `**${c.onVal}** for the ${c.next} right now` : "**1** while reds are on, then you take a colour"}), and the colour goes back on its spot.\n` +
      `In the app: after a foul tap **Free ball**, then tap the colour you potted.`,
  },
  {
    id: "free-behind",
    topic: "Snookers & free ball",
    q: "Can I snooker my opponent behind the free ball?",
    keys: "snooker behind free ball hide",
    a: () => `No. That's a foul, unless only the pink and black are left.`,
  },
  {
    id: "needs-snookers",
    topic: "Snookers & free ball",
    q: "What does 'needs snookers' mean?",
    keys: "needs snookers required behind points left can win",
    a: (c) => {
      if (c.generic) return `The player behind is trailing by more than the points left on the table, so they can only win by getting penalty points from fouls.`;
      const st = standing(c.s);
      const behind = st.leader === null ? null : c.players[1 - st.leader];
      return (
        `The player behind trails by more than the points left on the table, so only penalty points (from fouls) can save them.\n` +
        (behind ? `Now: **${behind}** is ${st.lead} behind with **${st.left}** left${st.snookers ? `, so they **need snookers**.` : `. Still possible without snookers.`}` : `The scores are level right now.`)
      );
    },
  },
  {
    id: "points-left",
    topic: "Snookers & free ball",
    q: "How many points are left on the table?",
    keys: "points left remaining table how many",
    a: (c) =>
      c.generic
        ? `8 per red (a red plus a black) plus 27 for the colours. 147 with 15 reds.`
        : `**${remaining(c.s)}**: ${c.reds} red${c.reds === 1 ? "" : "s"} at 8 each (red + black)${c.phase === "colour" ? ", the colour you're on (up to 7)" : ""}${c.phase === "clear" ? "" : ", plus 27 for the colours"}.`,
  },

  /* ---------------- End of frame ---------------- */
  {
    id: "frame-end",
    topic: "End of frame",
    q: "When does the frame end?",
    keys: "frame end over finish win when",
    a: () => `When the last black is potted, or when there's a foul with only the black left, or when someone concedes. If the scores are level at that point, there's a re-spotted black.`,
  },
  {
    id: "tie",
    topic: "End of frame",
    q: "What if the scores are level after the black?",
    keys: "tie level draw equal same score respot black",
    a: () =>
      `**Re-spotted black.** The black goes back on its spot, you toss a coin, and the winner chooses who plays. The white is in hand in the D. The next score or foul wins the frame.`,
  },
  {
    id: "foul-black",
    topic: "End of frame",
    q: "What if I foul on the last black?",
    keys: "foul last black final in-off end",
    a: (c) => `The frame ends: **${c.opp}** gets 7. If that leaves the scores level, it goes to a re-spotted black.`,
  },
  {
    id: "concede",
    topic: "End of frame",
    q: "When can I concede the frame?",
    keys: "concede give up resign forfeit",
    a: () => `Any time it's your turn. It's considered good manners to only concede once you need snookers. In the app: **⋯ → Concede frame**.`,
  },
  {
    id: "max",
    topic: "End of frame",
    q: "What's the maximum break?",
    keys: "maximum max break 147 highest",
    a: () => `**147** with 15 reds (each red with the black, then all the colours). With 10 reds it's ${maxBreak(10)}, with 6 reds ${maxBreak(6)}. A free ball at the start makes up to 155 possible.`,
  },

  /* ---------------- Basics ---------------- */
  {
    id: "break-off",
    topic: "Basics",
    q: "How do I break off?",
    keys: "break off start first shot opening",
    a: () => `Place the white anywhere in the D and hit a red. Any reds that go in count, and you carry on with a colour.`,
  },
  {
    id: "break-miss",
    topic: "Basics",
    q: "What if I miss the reds on the break?",
    keys: "break miss reds first shot foul opening",
    a: (c) => `Foul: 4 points to your opponent (more if you hit a colour first or potted one). ${c.generic ? "They" : c.opp} can play on or make you break again.`,
  },
  {
    id: "who-breaks",
    topic: "Basics",
    q: "Who breaks the next frame?",
    keys: "who breaks next frame alternate turn",
    a: () => `You take turns: the player who didn't break this frame breaks the next.`,
  },
  {
    id: "values",
    topic: "Basics",
    q: "How much is each ball worth?",
    keys: "value worth points ball each score",
    a: () => `Red 1 · Yellow 2 · Green 3 · Brown 4 · Blue 5 · Pink 6 · Black 7.`,
  },
  {
    id: "pool",
    topic: "Basics",
    q: "How is it different from pool?",
    keys: "pool difference 8 ball eight compared",
    a: () =>
      `• Fouls give **points to your opponent** (4 to 7), not ball in hand.\n• Ball in hand only after the white goes in or off, and only in the D.\n• No cushion needed after contact.\n• You don't call pockets, only which colour you're on.`,
  },
  {
    id: "stalemate",
    topic: "Basics",
    q: "What if neither of us can make progress?",
    keys: "stalemate stuck restart re-rack",
    a: () => `If you both agree it's a stalemate, re-rack and restart the frame (same player breaks).`,
  },
  {
    id: "undo",
    topic: "Basics",
    q: "I tapped the wrong ball. How do I fix it?",
    keys: "undo wrong tap mistake fix app",
    a: () => `Tap **Undo**. It takes back the last thing you logged, one step at a time.`,
  },
];

const SYN = [
  [/\bcue ?ball\b|\bcueball\b|\bcue\b/g, "white"],
  [/\bscratch(ed)?\b|\bin ?off\b/g, "white pot in-off"],
  [/\bcolou?red\b|\bcolou?rs?\b/g, "colour"],
  [/\bnominat\w*|\bcall(ed|ing|s)?\b|\bdeclar\w*/g, "call"],
  [/\bmiss(ed|es|ing)?\b/g, "miss"],
  [/\bsink(s|ing)?\b|\bsank\b|\bpocket(ed|s)?\b|\bpot(s|ted|ting)?\b/g, "pot"],
  [/\brespot\w*|\bre-spot\w*|\bput back\b/g, "respot back"],
  [/\breds\b/g, "red"],
  [/\bplant\w*|\bcombo\w*|\bcombination\w*/g, "plant"],
  [/\b(two|2) reds?\b/g, "two reds"],
  [/\b(yellow|green|brown|blue|pink|black)\b/g, "colour $1"],
  [/\bpenalt\w*/g, "penalty foul"],
];
const STOP = new Set("a an the i if my me what whats is it do does can could should when where who how to of on in and or with by for at be am are was will get gets got".split(" "));

const tokens = (text) => {
  let t = ` ${text.toLowerCase().replace(/[’']/g, "")} `;
  for (const [re, to] of SYN) t = t.replace(re, ` ${to} `);
  return t.split(/[^a-z0-9-]+/).filter((w) => w && !STOP.has(w));
};
const index = QA.map((e) => ({ e, keys: new Set(tokens(e.keys)), q: new Set(tokens(e.q)) }));

/** Best matches for a free-text question, best first. */
export function search(query, limit = 4) {
  const words = tokens(query);
  if (!words.length) return [];
  return index
    .map(({ e, keys, q }) => {
      let score = 0;
      for (const w of words) {
        if (q.has(w)) score += 2;
        else if (keys.has(w)) score += 1.5;
        else if (w.length > 3 && [...keys].some((k) => k.startsWith(w) || w.startsWith(k))) score += 0.5;
      }
      return { e, score: score / Math.sqrt(q.size + 2) };
    })
    .filter((r) => r.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.e);
}

/** Questions worth suggesting for the situation at the table. */
export function suggestions(s) {
  if (!s) return ["pot-white", "called-missed", "pot-via-red", "order", "foul-value", "spots"];
  if (s.toss) return ["tie", "place-white", "frame-end"];
  if (s.over) return ["who-breaks", "max", "tie"];
  if (s.foul) return ["after-foul", "free-ball", "play-again", "ball-in-hand", "foul-and-miss"];
  if (s.free) return ["free-ball", "free-behind", "snooker"];
  const st = standing(s);
  const list =
    s.phase === "red"
      ? ["pot-white", "red-and-white", "two-reds", "red-and-colour", "missed-pot", "hit-nothing"]
      : s.phase === "colour"
        ? ["called-missed", "pot-via-red", "wrong-colour", "colour-plant", "must-call", "pot-white"]
        : ["out-of-order", "pot-white", "foul-black", "tie", "missed-pot"];
  if (s.inHand) list.unshift("place-white");
  if (st.snookers) list.unshift("needs-snookers");
  return list.slice(0, 6);
}

export const byId = (id) => QA.find((e) => e.id === id);
export { VALUE };
