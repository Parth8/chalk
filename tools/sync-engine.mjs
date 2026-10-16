// Copies the rules engine (js/engine.js) into worker/worker.js, so the Worker checks every move
// with exactly the rules the page uses and still deploys as a single file you can paste.
//   npm run worker
// tests/worker.test.mjs fails if the copy ever drifts from js/engine.js.

import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const START = "// ---- engine: copied from js/engine.js by `npm run worker`. Don't edit it here. ----";
const END = "// ---- end engine ----";

/** The engine as it should appear inside the Worker: same code, nothing exported. */
export function engineBlock() {
  const src = readFileSync(new URL("js/engine.js", ROOT), "utf8").replace(/^export /gm, "").trim();
  return `${START}\n${src}\n${END}`;
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
  console.log("worker/worker.js: engine updated");
}
