#!/usr/bin/env node
/**
 * Regression test for the runner itself.
 *
 * The runner once reported ALL GREEN while pgTAP was printing "Looks like you
 * planned 23 tests but ran 22" — a harness that swallows its own failure signal
 * is worse than no harness. This script pins the fixed behaviour by running the
 * REAL runner (spawned as a child, so exit codes are the thing under test)
 * against fixture suites:
 *
 *   bad-plan    plan(2), one assertion   -> must exit non-zero, name the mismatch
 *   bad-assert  ok(false)                -> must exit non-zero
 *   good        clean plan(2), 2 passes  -> must exit 0 (runner not just failing everything)
 *
 * Usage: node self-test.mjs   (exit 0 iff all expectations hold)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function runWith(fixtureDir) {
  const r = spawnSync(process.execPath, [path.join(here, "run-tests.mjs")], {
    cwd: here,
    env: {
      ...process.env,
      TESTS_DIR: path.join(here, "self-test-fixtures", fixtureDir),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const checks = [];

{
  const { status, out } = runWith("bad-plan");
  checks.push([
    "plan mismatch makes the runner exit non-zero",
    status !== 0,
  ]);
  checks.push([
    "plan mismatch is named in the output",
    /plan mismatch: planned 2 assertions but ran 1|Looks like you planned/i.test(
      out,
    ),
  ]);
}

{
  const { status, out } = runWith("bad-assert");
  checks.push(["a failing assertion makes the runner exit non-zero", status !== 0]);
  checks.push(["the failing assertion is reported", /not ok/.test(out)]);
}

{
  const { status, out } = runWith("good");
  checks.push(["a clean suite still passes (exit 0)", status === 0]);
  checks.push(["clean suite reports ALL GREEN", /ALL GREEN/.test(out)]);
}

let bad = 0;
for (const [name, okay] of checks) {
  if (!okay) bad++;
  console.log(`${okay ? "ok" : "not ok"} - ${name}`);
}
if (bad) {
  console.error(`\nrunner self-test FAILED (${bad} check(s))`);
  process.exit(1);
}
console.log("\nrunner self-test passed");
