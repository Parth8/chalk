// Quick answers for 8-ball pool, worded for the game in front of you. Based on the WPA Rules
// of Play (effective 2025-09-15); common bar-rule differences are answered separately.
// Plain text with **bold**; the app escapes it before display.

import { groupFor, left, GROUP_WORDS } from "./pool.js";
import { BASE_SYN, makeSearch } from "./search.js";

export function context(s, players = ["You", "Your opponent"]) {
  if (!s) return { me: "you", opp: "your opponent", generic: true };
  const me = players[s.turn] || "you";
  const opp = players[1 - s.turn] || "your opponent";
  const g = groupFor(s, s.turn);
  const mine = g ? left(s, s.turn) : null;
  const on = !g ? "an open table" : mine.length ? GROUP_WORDS[g] : "the 8";
  return { s, me, opp, group: g, on, onEight: !!g && !mine.length };
}

export const TOPICS = ["Basics", "Racking & the break", "Open table & groups", "Your turn", "Fouls & ball in hand", "The 8-ball", "House rules"];

export const QA = [
  /* ---------------- Basics ---------------- */
  {
    id: "p-how",
    topic: "Basics",
    q: "How does 8-ball pool work?",
    keys: "how play work explain rules basics goal win",
    a: () =>
      `One of you pots the **solids (1–7)**, the other the **stripes (9–15)**. Clear your group, then pot the **black 8** to win.\n` +
      `Pot the 8 too early, in the wrong pocket, or on a foul, and you **lose**. There are no points: you win games.`,
  },
  {
    id: "p-names",
    topic: "Basics",
    q: "Is this pool or billiards?",
    keys: "pool billiards name called snooker difference english",
    a: () =>
      `People call it both. This is **8-ball pool**: 15 numbered balls and a white. **Snooker** (15 reds and 6 colours, with points) is the other game in this app. English billiards is a third game with just three balls.`,
  },
  {
    id: "p-groups",
    topic: "Basics",
    q: "Which balls are solids and which are stripes?",
    keys: "solids stripes which balls numbers colour striped spots big small",
    a: () => `**Solids** are 1 to 7, one plain colour. **Stripes** are 9 to 15, white with a coloured band. The **8** is black and belongs to nobody.`,
  },
  {
    id: "p-points",
    topic: "Basics",
    q: "Are there points in pool?",
    keys: "points score scoring count how much worth",
    a: () => `No. You win a game by potting the 8 at the right time. The app counts the **games won**, and shows how many of your balls are left.`,
  },
  {
    id: "p-who-breaks",
    topic: "Basics",
    q: "Who breaks?",
    keys: "who breaks first next game turn alternate toss lag",
    a: () => `Toss a coin for the first game (or "lag": both hit a ball up and back, closest to your end wins). After that you **take turns** to break.`,
  },
  {
    id: "p-stalemate",
    topic: "Basics",
    q: "What if neither of us can make progress?",
    keys: "stalemate stuck restart re-rack",
    a: () => `If you both agree it's stuck, re-rack and play it again, with the **same player** breaking. In the app: **⋯ → Restart this game**.`,
  },
  {
    id: "p-concede",
    topic: "Basics",
    q: "Can I give up a game?",
    keys: "concede give up resign forfeit",
    a: () => `Yes, and it counts as a game lost. In the app: **⋯ → Give up this game**.`,
  },

  /* ---------------- Racking & the break ---------------- */
  {
    id: "p-rack",
    topic: "Racking & the break",
    q: "How do I rack the balls?",
    keys: "rack set up setup triangle arrange start where balls go",
    show: "rack",
    a: () =>
      `Triangle's tip on the **foot spot** (the spot at the far end). The **8 in the middle** of the third row. One **solid** and one **stripe** in the two back corners. The rest in any order, packed tight. White anywhere **behind the line** at your end.`,
  },
  {
    id: "p-kitchen",
    topic: "Racking & the break",
    q: "What's the 'kitchen' (the head string)?",
    keys: "kitchen head string line behind baulk area break from",
    show: "kitchen",
    a: () => `The line across the table a quarter of the way from your end is the **head string**. The area behind it is called the **kitchen**. You break from there, and play from there after a scratch on the break.`,
  },
  {
    id: "p-break-legal",
    topic: "Racking & the break",
    q: "What counts as a good (legal) break?",
    keys: "break legal good illegal four 4 cushions rails",
    a: () =>
      `Pot at least one ball, **or** make at least **4 balls** hit a cushion. Otherwise it's an **illegal break**, and the other player chooses: play the table as it is, re-rack and break themselves, or make you break again.`,
  },
  {
    id: "p-break-scratch",
    topic: "Racking & the break",
    q: "What if the white goes in on the break?",
    keys: "break scratch white in-off cue ball pocket",
    a: (c) =>
      `It's a foul. Anything else that went in stays down (except the 8) and the table stays open. ${c.generic ? "The other player" : c.opp} gets the white **in hand behind the line** (in the kitchen), not anywhere.`,
  },
  {
    id: "p-break-8",
    topic: "Racking & the break",
    q: "What if the 8 goes in on the break?",
    keys: "8 eight black break pocket lose win",
    a: () =>
      `It's **not** a loss (or a win). The breaker chooses: put the 8 back on the foot spot and carry on, or break again.\n` +
      `If the white went in too, the **other player** chooses: spot the 8 and play with the white behind the line, or break again themselves.`,
  },
  {
    id: "p-break-groups",
    topic: "Racking & the break",
    q: "Do balls potted on the break decide my group?",
    keys: "break groups decide solids stripes choose potted first",
    a: () => `No. After the break the table is still **open**. Your group is decided by the next ball someone pots on purpose (their called ball).`,
  },
  {
    id: "p-break-off",
    topic: "Racking & the break",
    q: "A ball flew off the table on the break?",
    keys: "break off table jumped flew floor",
    a: () => `It's a foul. That ball stays off (only the 8 gets put back). The other player chooses: play the table as it is, or take the white behind the line.`,
  },

  /* ---------------- Open table & groups ---------------- */
  {
    id: "p-open",
    topic: "Open table & groups",
    q: "What's an 'open table'?",
    keys: "open table meaning before groups decided",
    a: () => `Nobody has a group yet. It lasts from the break until someone pots the ball they called. On an open table you may hit **any ball first except the 8**.`,
  },
  {
    id: "p-choose",
    topic: "Open table & groups",
    q: "How do I get solids or stripes?",
    keys: "choose group get solids stripes decide assign which",
    a: () => `On an open table, call a ball and pot it. Pot a solid and you're **solids** for the rest of the game; your opponent gets stripes (and the other way round).`,
  },
  {
    id: "p-open-8",
    topic: "Open table & groups",
    q: "Can I hit the 8 first on an open table?",
    keys: "open table hit 8 eight first black",
    a: () => `No, that's a foul: ball in hand for the other player. (The one exception: if a whole group is already down, you can claim it and play the 8.)`,
  },
  {
    id: "p-open-combo",
    topic: "Open table & groups",
    q: "On an open table, can I hit a stripe to pot a solid?",
    keys: "open table hit stripe pot solid combination other group",
    a: () => `Yes. On an open table any ball but the 8 can be hit first. If the solid was your called ball, you're solids.`,
  },
  {
    id: "p-open-both",
    topic: "Open table & groups",
    q: "A solid and a stripe both went in on an open table?",
    keys: "both solid stripe one each same shot open table which group",
    a: () => `The ball you **called** decides your group. The app asks which one it was.`,
  },

  /* ---------------- Your turn ---------------- */
  {
    id: "p-continue",
    topic: "Your turn",
    q: "When do I keep shooting?",
    keys: "keep shooting turn continue again visit",
    a: (c) => `As long as you pot one of your own balls each shot (${c.generic ? "your group" : c.on}). Miss, pot only theirs, or foul, and it's the other player's turn.`,
  },
  {
    id: "p-call",
    topic: "Your turn",
    q: "Do I have to call my shots?",
    keys: "call shot pocket ball say nominate obvious",
    a: () =>
      `Officially yes: say which ball and which pocket, unless it's obvious. Bank shots and combinations should always be called. Lucky balls that go in still count as long as your called ball went in too.\n` +
      `In the app, tapping a ball means "my called ball went in". For the 8, the app asks if it went in the pocket you called, because that decides the game.`,
  },
  {
    id: "p-their-ball",
    topic: "Your turn",
    q: "What if I pot my opponent's ball?",
    keys: "pot opponent other ball theirs wrong group",
    a: () => `If the white hit **your** ball first and nothing else went wrong, it's **not a foul**. Your turn ends, and their ball stays down (which helps them).`,
  },
  {
    id: "p-two-own",
    topic: "Your turn",
    q: "What if two of my balls go in on one shot?",
    keys: "two balls both mine same shot double",
    a: () => `Both count and you keep going. In the app, tap each ball that went in.`,
  },
  {
    id: "p-combo",
    topic: "Your turn",
    q: "Can I pot my ball by knocking another ball into it?",
    keys: "combination combo plant knock into hit another",
    a: () => `Yes, as long as the white hits **one of your own balls first**. With groups decided, you can't use the 8 or their ball as the first ball hit.`,
  },
  {
    id: "p-safety",
    topic: "Your turn",
    q: "What does calling 'safety' mean?",
    keys: "safety safe call defensive",
    a: () => `You say "safety" before the shot, meaning you're not trying to pot. Your turn ends after it even if one of your balls goes in (it stays down). In the app: **What happened? → Anything else? → I called safety**.`,
  },
  {
    id: "p-miss",
    topic: "Your turn",
    q: "What if I miss?",
    keys: "miss missed nothing went in turn",
    a: (c) => `If the white hit ${c.generic ? "one of your balls" : c.onEight ? "the 8" : "one of your balls"} first and then any ball touched a cushion, it's **not a foul**: it's just the other player's turn. Tap **Missed**.`,
  },
  {
    id: "p-rail",
    topic: "Your turn",
    q: "Does a ball have to hit a cushion?",
    keys: "cushion rail hit after contact touch",
    a: () => `Only when nothing goes in. Then, after the white hits a ball, **some ball** (the white or any other) has to touch a cushion. If none does, it's a foul.`,
  },

  /* ---------------- Fouls & ball in hand ---------------- */
  {
    id: "p-after-foul",
    topic: "Fouls & ball in hand",
    q: "What happens after a foul?",
    keys: "after foul what happens penalty ball in hand",
    a: (c) => `${c.generic ? "The other player" : c.opp} gets **ball in hand**: they put the white **anywhere on the table** and play. There are no points. Any balls that went in stay down.`,
  },
  {
    id: "p-scratch",
    topic: "Fouls & ball in hand",
    q: "What if I pot the white (scratch)?",
    keys: "scratch white pot cue ball in-off",
    a: (c) =>
      `Foul: ${c.generic ? "the other player" : c.opp} gets ball in hand anywhere. ${c.onEight ? "Careful: if the 8 goes in on the same shot, you **lose**." : "If it happens on the shot that pots the 8, you lose."}`,
  },
  {
    id: "p-in-hand",
    topic: "Fouls & ball in hand",
    q: "Where can I put the white with ball in hand?",
    keys: "ball in hand place white where anywhere move",
    show: "anywhere",
    a: () =>
      `**Anywhere on the table**, and you can move it (by hand, or nudge it with the cue but not a forward stroke) until you play. The only exception: after a scratch on the **break** it goes **behind the line** (in the kitchen).`,
  },
  {
    id: "p-kitchen-play",
    topic: "Fouls & ball in hand",
    q: "With the white behind the line, can I play a ball that's also behind the line?",
    keys: "kitchen behind line ball behind head string shoot back",
    a: () =>
      `Not directly. The white has to cross the line first (off a cushion is fine) before it hits a ball behind the line. If **all** your balls are behind the line, you can ask for the nearest one to be put on the foot spot.`,
  },
  {
    id: "p-wrong-first",
    topic: "Fouls & ball in hand",
    q: "What if I hit the wrong ball first?",
    keys: "wrong ball first hit opponent other group",
    a: (c) => `Foul: ball in hand for ${c.generic ? "the other player" : c.opp}. You have to hit ${c.generic ? "one of your own balls" : c.onEight ? "the 8" : c.group ? `one of your ${c.group}` : "any ball but the 8"} first. (If you hit two at the same moment and can't tell, it counts as the right one.)`,
  },
  {
    id: "p-no-hit",
    topic: "Fouls & ball in hand",
    q: "What if I miss every ball?",
    keys: "miss every ball nothing hit air",
    a: () => `Foul: ball in hand for the other player.`,
  },
  {
    id: "p-off",
    topic: "Fouls & ball in hand",
    q: "What if a ball flies off the table?",
    keys: "off table flew jumped floor ball",
    a: () => `Foul, and that ball **stays off**. If it's the **8**, you lose. A ball that bounces on the rail top and comes back onto the cloth isn't off.`,
  },
  {
    id: "p-touch",
    topic: "Fouls & ball in hand",
    q: "What if I touch a ball with my hand, cue or clothes?",
    keys: "touch ball hand cue sleeve clothes moved",
    a: () => `Foul: ball in hand for the other player. (Touching the white while you have ball in hand is fine.)`,
  },
  {
    id: "p-double",
    topic: "Fouls & ball in hand",
    q: "What about a double hit or push shot?",
    keys: "double hit push shot twice cue stays",
    a: () => `Both are fouls: hitting the white twice, or keeping the tip on it as it reaches the ball. If the white is touching a ball, shooting into that ball is allowed.`,
  },
  {
    id: "p-feet",
    topic: "Fouls & ball in hand",
    q: "Do I need a foot on the floor?",
    keys: "foot feet floor sit table leg",
    a: () => `Yes, at least one foot touching the floor when you hit the white. Otherwise it's a foul.`,
  },
  {
    id: "p-three",
    topic: "Fouls & ball in hand",
    q: "Do three fouls in a row lose the game?",
    keys: "three 3 fouls row lose",
    a: () => `Not in 8-ball. That rule is for 9-ball and 10-ball.`,
  },
  {
    id: "p-jump",
    topic: "Fouls & ball in hand",
    q: "Can I jump the white over a ball?",
    keys: "jump shot over ball scoop",
    a: () => `A proper jump shot (cue raised, hitting down on the white) is legal under world rules. Lots of friendly games ban jumping: agree before you start.`,
  },
  {
    id: "p-touching",
    topic: "Fouls & ball in hand",
    q: "The white is touching another ball. What now?",
    keys: "touching frozen white against ball kissing",
    a: () => `If that ball is one you're allowed to hit, you can shoot into it and it counts as hit. Playing away from it doesn't count as hitting it.`,
  },
  {
    id: "p-settle",
    topic: "Fouls & ball in hand",
    q: "A ball dropped into the pocket a few seconds later?",
    keys: "ball fell dropped later pocket edge hanging own settle bounced out",
    a: () => `If it had stopped for about 5 seconds and then fell in by itself, it's put back. A ball that bounces back out of a pocket isn't potted.`,
  },

  /* ---------------- The 8-ball ---------------- */
  {
    id: "p-8-when",
    topic: "The 8-ball",
    q: "When can I go for the 8?",
    keys: "when 8 eight black go for shoot",
    a: (c) => `Only once **all** your group is down. Then call the pocket for the 8 and pot it to win.${c.onEight ? ` That's ${c.me} now.` : ""}`,
  },
  {
    id: "p-8-lose",
    topic: "The 8-ball",
    q: "How can I lose on the 8?",
    keys: "lose 8 eight black how ways",
    a: () =>
      `You lose the game if you:\n• Pot the 8 before your group is down (including on the same shot as your last ball)\n• Pot the 8 in a pocket you didn't call\n• Pot the 8 and foul on the same shot (like a scratch)\n• Knock the 8 off the table\nNone of these count on the break.`,
  },
  {
    id: "p-8-scratch",
    topic: "The 8-ball",
    q: "What if I scratch while shooting at the 8?",
    keys: "scratch 8 eight black white in lose",
    a: () =>
      `If the 8 goes in too: you **lose**. If the 8 doesn't go in: under world rules it's just a foul (ball in hand for the other player). Many bars play "scratch on the 8 loses" either way: agree before you start.`,
  },
  {
    id: "p-8-pocket",
    topic: "The 8-ball",
    q: "What if the 8 goes in the wrong pocket?",
    keys: "8 eight wrong pocket uncalled different",
    a: () => `You lose. That's why you always say which pocket for the 8.`,
  },
  {
    id: "p-8-last",
    topic: "The 8-ball",
    q: "Can I pot my last ball and the 8 together?",
    keys: "last ball 8 eight together same shot both",
    a: () => `No: that loses. The 8 has to be the **last** ball you pot, on a shot of its own.`,
  },
  {
    id: "p-8-gift",
    topic: "The 8-ball",
    q: "My opponent potted my last ball for me. Now what?",
    keys: "opponent potted my last ball for me on 8",
    a: () => `Your group is down, so on your turn you're **on the 8**.`,
  },
  {
    id: "p-8-spot",
    topic: "The 8-ball",
    q: "Where does the 8 go when it's put back?",
    keys: "8 eight spot put back where foot spot respot",
    show: "spot",
    a: () => `On the **foot spot** (where the tip of the triangle was). If a ball is in the way, put it as close as you can directly behind the spot, towards the far cushion.`,
  },

  /* ---------------- House rules ---------------- */
  {
    id: "p-bar",
    topic: "House rules",
    q: "Our bar plays different rules. Which ones does the app use?",
    keys: "bar house rules different pub local variation",
    a: () =>
      `The app follows the **world (WPA) rules**. Common bar rules that differ:\n• Scratch on the 8 loses, even if the 8 didn't go in\n• After a scratch, ball in hand only behind the line\n• Only the 8 has to be called\n• Jump shots not allowed\nAgree the house rules before you start. When they differ, use **Undo** and log what you agreed.`,
  },
  {
    id: "p-uk",
    topic: "House rules",
    q: "We play with red and yellow balls. Does this work?",
    keys: "red yellow uk english blackball pub two shots visits",
    a: () =>
      `That's UK pub pool ("blackball"). Its fouls work differently (usually the other player gets **two visits** instead of ball in hand). You can still use the app: treat reds as solids and yellows as stripes, but the foul rulings follow world rules.`,
  },

  {
    id: "p-undo",
    topic: "Basics",
    q: "I tapped the wrong thing. How do I fix it?",
    keys: "undo wrong tap mistake fix app",
    a: () => `Tap **Undo**. It takes back the last thing you logged, one step at a time.`,
  },
  {
    id: "p-how-tap",
    topic: "Basics",
    q: "How do I use the app for pool?",
    keys: "how use app tap log balls potted",
    a: () =>
      `• **The break:** tap **Log the break** and say what happened.\n• **One of your balls went in:** tap it.\n• **Nothing went in:** tap **Missed**.\n• **Anything odd** (white went in, wrong ball first, not sure if it's a foul): tap **What happened?** and the app works it out, including ball in hand.`,
  },
];

const SYN = [
  ...BASE_SYN,
  [/\bcue\b/g, "white"],
  [/\bscratch(ed|es)?\b|\bin ?off\b/g, "scratch white"],
  [/\beight\b|\b8 ?ball\b|\bblack\b/g, "8"],
  [/\bstriped?\b|\bstripes\b/g, "stripes"],
  [/\bsolid\b/g, "solids"],
  [/\brails?\b/g, "cushion"],
  [/\bcushions\b/g, "cushion"],
  [/\bhead ?string\b|\bbaulk\b/g, "kitchen"],
  [/\bcombos?\b|\bcombinations?\b|\bplants?\b/g, "combination"],
];

export const search = makeSearch(QA, SYN);

export function suggestions(s) {
  if (!s) return ["p-how", "p-groups", "p-break-legal", "p-scratch", "p-8-lose", "p-call"];
  if (s.over) return ["p-who-breaks", "p-8-lose", "p-bar"];
  if (s.choice) return s.choice.kind.startsWith("eight") ? ["p-break-8", "p-8-spot", "p-break-legal"] : ["p-break-legal", "p-break-off", "p-break-scratch"];
  if (s.breakShot) return ["p-break-legal", "p-break-scratch", "p-break-8", "p-rack", "p-kitchen", "p-break-groups"];
  const list = [];
  if (s.inHand) list.push("p-in-hand", s.inHand === "kitchen" ? "p-kitchen-play" : "p-after-foul");
  const g = groupFor(s, s.turn);
  if (!g) list.push("p-open", "p-choose", "p-open-8", "p-open-both");
  else if (!left(s, s.turn).length) list.push("p-8-when", "p-8-lose", "p-8-scratch", "p-8-pocket");
  else list.push("p-continue", "p-their-ball", "p-wrong-first", "p-rail", "p-scratch");
  list.push("p-call", "p-safety");
  return [...new Set(list)].slice(0, 6);
}

export const byId = (id) => QA.find((e) => e.id === id);
