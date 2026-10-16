import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);

test("the service worker caches every script and stylesheet, so the app works with no signal", () => {
  const sw = readFileSync(new URL("sw.js", root), "utf8");
  const listed = new Set(JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]")));
  const onDisk = ["css", "js", "vendor"].flatMap((dir) =>
    readdirSync(new URL(`${dir}/`, root), { recursive: true })
      .filter((f) => /\.(js|mjs|css)$/.test(f))
      .map((f) => `${dir}/${f}`)
  );
  for (const file of onDisk) assert.ok(listed.has(file), `${file} is missing from FILES in sw.js`);
  for (const file of listed) assert.ok(file === "./" || readFileSync(new URL(file, root)), `${file} is listed but doesn't exist`);
});
