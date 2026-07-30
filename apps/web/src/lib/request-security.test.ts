import { describe, expect, it } from "vitest";
import { isSameOriginRequest, readSmallUrlEncodedForm, safeInternalPath } from "./request-security";

describe("request security helpers", () => {
  it("accepts canonical internal redirect paths only", () => {
    expect(safeInternalPath("/consultation/123?tab=result")).toBe("/consultation/123?tab=result");
    for (const unsafe of ["https://example.com", "//example.com", "/\\example.com", "/%2f%2fexample.com", "/%5cexample.com"]) expect(safeInternalPath(unsafe)).toBe("/");
  });

  it("requires an exact Origin match", () => {
    expect(isSameOriginRequest(new Request("https://app.test/api", { headers: { origin: "https://app.test" } }))).toBe(true);
    expect(isSameOriginRequest(new Request("https://app.test/api", { headers: { origin: "https://other.test" } }))).toBe(false);
    expect(isSameOriginRequest(new Request("https://app.test/api"))).toBe(false);
  });

  it("uses the public Host when a framework normalizes the request URL", () => {
    const request = new Request("http://localhost:3100/api/sessions", {
      headers: { origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" },
    });
    expect(isSameOriginRequest(request)).toBe(true);
    expect(isSameOriginRequest(new Request(request, { headers: { origin: "http://other.test", host: "127.0.0.1:3100" } }))).toBe(false);
  });

  it("bounds and parses urlencoded forms", async () => {
    const request = new Request("https://app.test/api", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=stylist%40example.com&role=stylist" });
    expect((await readSmallUrlEncodedForm(request)).get("email")).toBe("stylist@example.com");
    const oversized = new Request("https://app.test/api", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "9000" }, body: "x=1" });
    await expect(readSmallUrlEncodedForm(oversized)).rejects.toThrow("too large");
  });
});
