// Plain-word search over quick answers, shared by snooker and pool. Words are folded into a
// few canonical ones first (cue ball → white, sank → pot), then scored against each question.

export const BASE_SYN = [
  [/\bcue ?ball\b|\bcueball\b/g, "white"],
  [/\bnominat\w*|\bcall(ed|ing|s)?\b|\bdeclar\w*/g, "call"],
  [/\bmiss(ed|es|ing)?\b/g, "miss"],
  [/\bsink(s|ing)?\b|\bsank\b|\bpocket(ed|s)?\b|\bpot(s|ted|ting)?\b/g, "pot"],
  [/\bpenalt\w*/g, "penalty foul"],
];
const STOP = new Set("a an the i if my me what whats is it do does can could should when where who how to of on in and or with by for at be am are was will get gets got".split(" "));

export function makeSearch(QA, syn) {
  const tokens = (text) => {
    let t = ` ${text.toLowerCase().replace(/[’']/g, "")} `;
    for (const [re, to] of syn) t = t.replace(re, ` ${to} `);
    return t.split(/[^a-z0-9-]+/).filter((w) => w && !STOP.has(w));
  };
  const index = QA.map((e) => ({ e, keys: new Set(tokens(e.keys)), q: new Set(tokens(e.q)) }));
  /** Best matches for a free-text question, best first. */
  return function search(query, limit = 4) {
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
  };
}
