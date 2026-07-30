import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationRequired, MembershipRequired } from "./supabase/auth";
import { withRequestStore } from "./store";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status: 400 });
}

export function notFound(message = "찾을 수 없습니다.") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message = "서버 오류가 발생했습니다.") {
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Wrap a handler with uniform error handling. */
export async function guard(
  fn: () => Promise<Response>,
  opts: { authenticated?: boolean } = {},
): Promise<Response> {
  try {
    return opts.authenticated === false ? await fn() : await withRequestStore(fn);
  } catch (err) {
    if (err instanceof AuthenticationRequired) return NextResponse.json({ error: "authentication required" }, { status: 401 });
    if (err instanceof MembershipRequired) return NextResponse.json({ error: "salon membership required" }, { status: 403 });
    if (err instanceof ZodError) {
      return badRequest("입력값이 올바르지 않습니다.", err.flatten());
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
