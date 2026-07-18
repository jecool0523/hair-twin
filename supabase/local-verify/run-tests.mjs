#!/usr/bin/env node
/**
 * Offline pgTAP runner.
 *
 * `supabase test db` needs Docker to boot the local stack. Where Docker is not
 * available, this runs the SAME migrations and the SAME pgTAP test files against
 * PGlite — a real PostgreSQL build compiled to WASM — behind a small shim that
 * provides what Supabase itself would (auth/storage schemas, the anon /
 * authenticated / service_role roles, auth.uid()).
 *
 * STRICTNESS: this runner previously only counted `ok` / `not ok` lines, so a
 * pgTAP plan mismatch — the suite promising N assertions but running fewer —
 * was reported as ALL GREEN. That is exactly the failure mode a test harness
 * exists to catch. A file now FAILS if ANY of the following holds:
 *
 *   - it emits no TAP plan (`1..N`), or more than one
 *   - the number of executed assertions (ok + not ok) differs from the plan
 *   - finish() emits a "Looks like ..." diagnostic (pgTAP's own mismatch check)
 *   - a "Bail out!" line appears
 *   - any assertion is `not ok`
 *   - the file throws instead of completing
 *
 * The runner's own behaviour is regression-tested by self-test.mjs against
 * fixtures with deliberate plan mismatches (TESTS_DIR overrides the suite dir).
 *
 * It remains a stand-in for the real local stack, not a replacement: it does
 * not exercise PostgREST, GoTrue, or the storage API. Once a Supabase project
 * is chosen, `supabase test db` runs the identical files.
 *
 * Usage:  node supabase/local-verify/run-tests.mjs
 * Exit code is non-zero if any file fails any check above.
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, "..");
const migrationsDir = path.join(supabaseDir, "migrations");
const testsDir = process.env.TESTS_DIR
  ? path.resolve(process.env.TESTS_DIR)
  : path.join(supabaseDir, "tests");
const pgtapPath = path.join(here, "vendor", "pgtap.sql");

function readSorted(dir, suffix) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

/**
 * Strict TAP scrutiny for one file's collected output.
 * Returns { passed, failures: string[] } — failures is every reason this file
 * cannot be trusted, not just the first.
 */
export function scrutinizeTap(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const failures = [];
  let passed = 0;
  let notOk = 0;

  const plans = [];
  for (const line of lines) {
    const planMatch = /^1\.\.(\d+)$/.exec(line);
    if (planMatch) plans.push(Number(planMatch[1]));
    else if (/^ok\b/.test(line)) passed++;
    else if (/^not ok\b/.test(line)) {
      notOk++;
      failures.push(line);
    } else if (/^Bail out!/i.test(line)) {
      failures.push(`bail: ${line}`);
    } else if (/Looks like you planned/i.test(line)) {
      // pgTAP's finish() computed a mismatch itself. Trust its arithmetic too.
      failures.push(`pgTAP diagnostic: ${line.replace(/^#\s*/, "")}`);
    } else if (/Looks like you failed/i.test(line)) {
      failures.push(`pgTAP diagnostic: ${line.replace(/^#\s*/, "")}`);
    }
  }

  const ran = passed + notOk;
  if (plans.length === 0) {
    failures.push("no TAP plan (1..N) found — file did not run plan()");
  } else if (plans.length > 1) {
    failures.push(`multiple TAP plans found (${plans.join(", ")})`);
  } else if (ran !== plans[0]) {
    failures.push(
      `plan mismatch: planned ${plans[0]} assertions but ran ${ran}`,
    );
  }
  if (plans.length === 1 && ran === 0) {
    failures.push("zero assertions executed");
  }

  return { passed, failures };
}

async function main() {
  if (!fs.existsSync(pgtapPath)) {
    console.error(
      `pgTAP not vendored at ${pgtapPath}\n` +
        `Run: node supabase/local-verify/fetch-pgtap.mjs`,
    );
    process.exit(2);
  }

  const db = await PGlite.create();
  const version = (await db.query("select version()")).rows[0].version;
  console.log(`# engine: ${version.split(" on ")[0]} (PGlite, offline runner)`);
  if (process.env.TESTS_DIR) {
    console.log(`# tests dir override: ${testsDir}`);
  }

  // 1. Supabase environment shim.
  await db.exec(fs.readFileSync(path.join(here, "shim.sql"), "utf8"));

  // 2. The real migrations, in order.
  for (const m of readSorted(migrationsDir, ".sql")) {
    try {
      await db.exec(m.sql);
      console.log(`# migration applied: ${m.name}`);
    } catch (err) {
      console.error(`\nMIGRATION FAILED: ${m.name}\n${err.message}`);
      process.exit(1);
    }
  }

  // 3. pgTAP itself.
  await db.exec(fs.readFileSync(pgtapPath, "utf8"));

  // 4. Each test file. They manage their own begin/rollback.
  let totalPassed = 0;
  const allFailures = [];
  const files = readSorted(testsDir, ".test.sql");
  if (files.length === 0) {
    console.error(`no *.test.sql files found in ${testsDir}`);
    process.exit(2);
  }
  for (const t of files) {
    console.log(`\n# ${t.name}`);
    let out = "";
    let threw = false;
    try {
      const results = await db.exec(t.sql);
      for (const r of results) {
        for (const row of r.rows ?? []) {
          const line = Object.values(row)[0];
          if (typeof line === "string") {
            out += line + "\n";
            console.log(line);
          }
        }
      }
    } catch (err) {
      threw = true;
      console.error(`not ok - ${t.name} raised: ${err.message}`);
      allFailures.push(`${t.name}: raised: ${err.message}`);
      // Leave the aborted transaction behind before the next file.
      try {
        await db.exec("rollback");
      } catch {
        /* already rolled back */
      }
    }
    if (threw) continue;

    const { passed, failures } = scrutinizeTap(out);
    totalPassed += passed;
    allFailures.push(...failures.map((f) => `${t.name}: ${f}`));
  }

  console.log(`\n# passed: ${totalPassed}`);
  if (allFailures.length) {
    console.log(`# failed checks: ${allFailures.length}`);
    for (const f of allFailures) console.log(`#   ${f}`);
    console.log("# result: FAILED");
    process.exit(1);
  }
  console.log("# result: ALL GREEN");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
