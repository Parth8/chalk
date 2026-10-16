// Copies the rules engines (js/snooker/engine.js and js/pool/engine.js) into worker/worker.js,
// so the Worker checks every move with exactly the rules the page uses and still deploys as a
// single file you can paste. Each engine sits in its own namespace (SNOOKER, POOL).
//   npm run worker
// tests/worker.test.mjs fails if the copy ever drifts from the engines.

import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const START = "// ---- engines: copied from js/snooker/engine.js and js/pool/engine.js by `npm run worker`. Don't edit them here. ----";
const END = "// ---- end engines ----";

function namespaced(name, file) {
  const src = readFileSync(new URL(file, ROOT), "utf8").trim();
  const names = [...src.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export /gm, "").replace(/^/gm, "  ").replace(/^ +$/gm, "");
  return `const ${name} = (() => {\n${body}\n  return { ${names.join(", ")} };\n})();`;
}

/** The engines as they should appear inside the Worker. */
export function engineBlock() {
  return `${START}\n${namespaced("SNOOKER", "js/snooker/engine.js")}\n\n${namespaced("POOL", "js/pool/engine.js")}\n${END}`;
}

export function workerWithEngine(worker) {
  const a = worker.indexOf(START);
  const b = worker.indexOf(END);
  if (a < 0 || b < a) throw new Error("engine markers missing from worker/worker.js");
  return worker.slice(0, a) + engineBlock() + worker.slice(b + END.length);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const file = new URL("worker/worker.js", ROOT);
  writeFileSync(file, workerWithEngine(readFileSync(file, "utf8")));
  console.log("worker/worker.js: engines updated");
}
