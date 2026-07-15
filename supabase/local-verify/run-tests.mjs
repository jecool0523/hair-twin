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
 * It is a stand-in for the local stack, not a replacement for it: it does not
 * exercise PostgREST, GoTrue, or the storage API. Once a Supabase project is
 * chosen, `supabase test db` runs the identical files (see supabase/README.md).
 *
 * Usage:  node supabase/local-verify/run-tests.mjs
 * Exit code is non-zero if any assertion fails.
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, "..");
const migrationsDir = path.join(supabaseDir, "migrations");
const testsDir = path.join(supabaseDir, "tests");
const pgtapPath = path.join(here, "vendor", "pgtap.sql");

function readSorted(dir, suffix) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

/** Parse TAP output into a pass/fail tally. */
function parseTap(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const failures = [];
  let passed = 0;
  for (const line of lines) {
    if (/^ok\b/.test(line)) passed++;
    else if (/^not ok\b/.test(line)) failures.push(line);
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
  for (const t of readSorted(testsDir, ".test.sql")) {
    console.log(`\n# ${t.name}`);
    let out = "";
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
      // A thrown error means the test file itself broke (not an assertion).
      console.error(`not ok - ${t.name} raised: ${err.message}`);
      allFailures.push(`${t.name}: ${err.message}`);
      // Leave the aborted transaction behind before the next file.
      try {
        await db.exec("rollback");
      } catch {
        /* already rolled back */
      }
      continue;
    }
    const { passed, failures } = parseTap(out);
    totalPassed += passed;
    allFailures.push(...failures.map((f) => `${t.name}: ${f}`));
  }

  console.log(`\n# passed: ${totalPassed}`);
  if (allFailures.length) {
    console.log(`# failed: ${allFailures.length}`);
    for (const f of allFailures) console.log(`#   ${f}`);
    process.exit(1);
  }
  console.log("# result: ALL GREEN");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
