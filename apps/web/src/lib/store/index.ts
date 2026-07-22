/**
 * Store singleton. Survives Next.js dev hot-reload via globalThis.
 *
 * `HAIR_TWIN_STORE=supabase` is reserved for the future Supabase-backed store
 * (not wired yet — ADR-0003). Until then, everything runs on the in-memory
 * store, which is why no infrastructure needs to be connected to run the flow.
 */
import "server-only";
import { InMemoryStore } from "./memory";
import type { HairTwinStore } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __hairTwinStore: HairTwinStore | undefined;
}

export function getStore(): HairTwinStore {
  const mode = (process.env.HAIR_TWIN_STORE ?? "memory").toLowerCase();
  if (mode === "supabase") {
    // Intentionally not implemented yet. Fail loud rather than silently using a
    // half-configured backend against real customer data.
    throw new Error(
      "HAIR_TWIN_STORE=supabase is not wired yet (see docs/decisions/ADR-0003). Use 'memory' for local development.",
    );
  }
  if (!globalThis.__hairTwinStore) {
    globalThis.__hairTwinStore = new InMemoryStore();
  }
  return globalThis.__hairTwinStore;
}

export { newId } from "./memory";
