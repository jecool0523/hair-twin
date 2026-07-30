import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { InMemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import { resolveAuthContext, type AuthContext } from "../supabase/auth";
import type { HairTwinStore } from "./types";

interface RequestState { store: HairTwinStore; auth?: AuthContext }
const requestState = new AsyncLocalStorage<RequestState>();

declare global {
  // eslint-disable-next-line no-var
  var __hairTwinStore: HairTwinStore | undefined;
}

export function isSupabaseMode() {
  return (process.env.HAIR_TWIN_STORE ?? "memory").toLowerCase() === "supabase";
}

export function getStore(): HairTwinStore {
  if (isSupabaseMode()) {
    const state = requestState.getStore();
    if (!state) throw new Error("SupabaseStore requires an authenticated request context");
    return state.store;
  }
  if (!globalThis.__hairTwinStore) globalThis.__hairTwinStore = new InMemoryStore();
  return globalThis.__hairTwinStore;
}

export function getActorContext() {
  const auth = requestState.getStore()?.auth;
  return auth ? { salonId: auth.salonId, stylistId: auth.userId } : { salonId: "salon_dev", stylistId: "stylist_dev" };
}

export function getRequestAuth() {
  const auth = requestState.getStore()?.auth;
  if (!auth) throw new Error("authenticated request context is unavailable");
  return auth;
}

export async function withRequestStore<T>(fn: () => Promise<T>): Promise<T> {
  if (!isSupabaseMode()) return fn();
  const existing = requestState.getStore();
  if (existing) return fn();
  const auth = await resolveAuthContext();
  return requestState.run({ store: new SupabaseStore(auth), auth }, fn);
}

export { newId } from "./memory";
