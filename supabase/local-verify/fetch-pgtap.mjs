#!/usr/bin/env node
/**
 * Vendor pgTAP's SQL install script for the offline runner.
 *
 * pgTAP is pure SQL/PL-pgSQL (no C module), so it can be loaded into PGlite.
 * The real local Supabase stack instead gets pgTAP via `create extension pgtap`.
 * We fetch rather than commit ~1MB of third-party SQL into this repo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";

const VERSION = "1.3.3";
const URL = `https://api.pgxn.org/dist/pgtap/${VERSION}/pgtap-${VERSION}.zip`;

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(here, "vendor");
const out = path.join(vendorDir, "pgtap.sql");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgtap-"));
const zip = path.join(tmp, "pgtap.zip");

console.log(`fetching pgTAP ${VERSION}…`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

// `unzip` on POSIX/Git-Bash; PowerShell Expand-Archive elsewhere.
try {
  execFileSync("unzip", ["-o", "-q", zip, "-d", tmp], { stdio: "inherit" });
} catch {
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Force -Path '${zip}' -DestinationPath '${tmp}'`,
  ]);
}

const src = path.join(tmp, `pgtap-${VERSION}`, "sql", "pgtap.sql.in");
let sql = fs.readFileSync(src, "utf8");
// Substitutions the pgTAP Makefile performs at build time.
sql = sql.replace(/TAPSCHEMA/g, "public").replace(/__VERSION__/g, "1.3");

fs.mkdirSync(vendorDir, { recursive: true });
fs.writeFileSync(out, sql);
console.log(`vendored -> ${path.relative(process.cwd(), out)} (${sql.length} bytes)`);
