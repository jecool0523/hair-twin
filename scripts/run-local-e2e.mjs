import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const origin = "http://127.0.0.1:3100";
const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const python = process.env.PYTHON_EXECUTABLE;
if (!api || !publishable || !secret || !python) throw new Error("local E2E environment is incomplete");
const apiUrl = new URL(api);
if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname)) throw new Error("local E2E refuses a non-loopback Supabase URL");

const admin = async (route, init = {}) => {
  const response = await fetch(`${api}${route}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`fixture request failed ${route} (${response.status})`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

let cookie = "";
const updateCookies = (response) => {
  const set = response.headers.getSetCookie?.() ?? [];
  const values = new Map(cookie.split("; ").filter(Boolean).map((item) => item.split(/=(.*)/s).slice(0, 2)));
  for (const line of set) {
    const [pair] = line.split(";");
    const [name, value] = pair.split(/=(.*)/s).slice(0, 2);
    if (value) values.set(name, value); else values.delete(name);
  }
  cookie = [...values].map(([name, value]) => `${name}=${value}`).join("; ");
};
const request = async (route, init = {}) => {
  const response = await fetch(new URL(route, origin), {
    ...init,
    redirect: "manual",
    headers: { ...(!["GET", "HEAD"].includes(init.method ?? "GET") ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  updateCookies(response);
  return response;
};
const json = async (route, body) => request(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const expectStatus = (response, status, label) => {
  if (response.status !== status) throw new Error(`${label} expected ${status}, received ${response.status}`);
};

const email = `e2e-${randomUUID()}@example.test`;
const password = `Local-${randomUUID()}!`;
const organizationId = randomUUID();
const salonId = randomUUID();
let user;
let server;
try {
  user = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await admin("/rest/v1/organizations", { method: "POST", body: JSON.stringify({ id: organizationId, name: "Browser E2E Org" }) });
  await admin("/rest/v1/salons", { method: "POST", body: JSON.stringify({ id: salonId, organization_id: organizationId, name: "Browser E2E Salon" }) });
  await admin("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: user.id, display_name: "E2E Owner" }) });
  await admin("/rest/v1/salon_memberships", { method: "POST", body: JSON.stringify({ salon_id: salonId, profile_id: user.id, role: "owner" }) });

  const nextCli = path.join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextCli, "dev", "-p", "3100"], {
    cwd: path.join(root, "apps", "web"), env: { ...process.env, HAIR_TWIN_STORE: "supabase", HAIR_TWIN_PROVIDER: "mock" },
    stdio: "ignore", windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/login`)).status === 200) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (attempt === 59) throw new Error("Next.js dev server did not become ready");
  }

  const login = await request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password, next: "/" }),
  });
  expectStatus(login, 303, "login");
  expectStatus(await request("/"), 200, "session landing page");
  const sessionResponse = await json("/api/sessions", { stylistName: "E2E Owner", customerAlias: "E2E Customer" });
  expectStatus(sessionResponse, 200, "session creation");
  const { sessionId } = await sessionResponse.json();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("session creation did not return a UUID");
  expectStatus(await request(`/consultation/${sessionId}`), 200, "consultation page");

  expectStatus(await json(`/api/sessions/${sessionId}/consent`, {
    captureConsented: true, saveImagesConsented: true, saveReportConsented: false, wordingVersion: "draft-ko-2026-07",
  }), 200, "consent");

  const image = readFileSync(path.join(root, "outputs", "marketing", "creative", "dm-attachment-concepts", "hair-twin-dm-01-salon-consultation.png"));
  const width = 48, height = 64;
  const region = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const head = Math.abs(x - width / 2) <= width * 0.25;
    region[y * width + x] = y > height * 0.78 ? 3 : head && y < height * 0.3 ? 1 : head && y < height * 0.72 ? 2 : 0;
  }
  const form = new FormData();
  form.set("image", new Blob([image], { type: "image/png" }), "source.png");
  form.set("regionMap", new Blob([region], { type: "application/octet-stream" }), "region.bin");
  form.set("regionMapWidth", String(width));
  form.set("regionMapHeight", String(height));
  form.set("preflight", JSON.stringify({ faceCount: 1, passed: true, engine: "heuristic" }));
  const capture = await request(`/api/sessions/${sessionId}/source`, { method: "POST", body: form });
  expectStatus(capture, 200, "multipart capture");
  const captured = await capture.json();

  const create = await json(`/api/sessions/${sessionId}/jobs`, { styleId: "layered-c-curl", candidateCount: 3, maskContractId: captured.maskContractId });
  expectStatus(create, 200, "job creation");
  const workerProgram = [
    "from app.main import process_once",
    "processed = 0",
    "for _ in range(64):",
    "    if not process_once(): break",
    "    processed += 1",
    "assert processed > 0",
  ].join("\n");
  const worker = spawnSync(python, ["-c", workerProgram], {
    cwd: path.join(root, "workers", "ai-worker"),
    env: { ...process.env, SUPABASE_URL: api, HAIR_TWIN_PROVIDER: "mock", HAIR_TWIN_ALLOW_MOCK: "true" },
    encoding: "utf8", windowsHide: true,
  });
  if (worker.status !== 0) throw new Error(`worker process failed (${worker.status}): ${worker.stderr.trim()}`);

  const viewResponse = await request(`/api/sessions/${sessionId}`);
  expectStatus(viewResponse, 200, "session polling");
  const view = await viewResponse.json();
  const candidate = view.jobs?.[0]?.candidates?.find((item) => item.canApprove);
  if (!candidate) {
    const workerRows = await admin(`/rest/v1/generation_jobs?session_id=eq.${sessionId}&select=status,attempts,failure_reason`);
    throw new Error(`worker produced no approvable candidate: ${JSON.stringify({ jobs: view.jobs, workerRows })}`);
  }
  expectStatus(await json(`/api/candidates/${candidate.id}/verdict`, { verdict: "usable" }), 200, "stylist verdict");
  const media = await request(candidate.mediaUrl);
  expectStatus(media, 200, "private media");
  if (!(media.headers.get("content-type") ?? "").startsWith("image/")) throw new Error("private media MIME is invalid");
  expectStatus(await json(`/api/sessions/${sessionId}/decision`, { action: "save", candidateIds: [candidate.id] }), 200, "save decision");
  const saved = await (await request(`/api/sessions/${sessionId}`)).json();
  if (saved.stage !== "saved") throw new Error("consultation did not reach saved stage");

  expectStatus(await request("/api/auth/logout", { method: "POST" }), 303, "logout");
  expectStatus(await request(`/api/sessions/${sessionId}`), 401, "post-logout access");
  console.log("local E2E passed: auth, consultation, multipart, worker, QC, private media, save, logout");
} finally {
  if (server) server.kill();
  if (organizationId) await admin(`/rest/v1/organizations?id=eq.${organizationId}`, { method: "DELETE" }).catch(() => undefined);
  if (user?.id) await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => undefined);
}
