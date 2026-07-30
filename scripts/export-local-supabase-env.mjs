import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const values = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  HAIR_TWIN_STORE: "supabase",
  RUN_SUPABASE_INTEGRATION: "1",
  MEDIA_TOKEN_SECRET: status.JWT_SECRET,
};
const destination = process.env.GITHUB_ENV;
if (!destination) throw new Error("GITHUB_ENV is required; refusing to print credentials");
for (const [name, value] of Object.entries(values)) appendFileSync(destination, `${name}=${value}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`exported ${Object.keys(values).length} local integration variables without printing values`);
