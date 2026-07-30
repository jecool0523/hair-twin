import { describe, expect, it, vi } from "vitest";
import { TestInviteEmailProvider, WebhookInviteEmailProvider } from "./invite";

describe("invite email provider boundary", () => {
  it("captures the exact local/test delivery contract", async () => {
    const provider = new TestInviteEmailProvider();
    await provider.send({ email: "invitee@example.test", salonId: "salon", role: "stylist", acceptUrl: "https://example.test/invite/accept?id=fixture" });
    expect(provider.sent).toHaveLength(1);
  });

  it("treats webhook failures as delivery failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(new WebhookInviteEmailProvider("https://mail.example.test", "secret").send({
      email: "invitee@example.test", salonId: "salon", role: "admin", acceptUrl: "https://example.test/invite/accept?id=fixture",
    })).rejects.toThrow(/503/);
    vi.unstubAllGlobals();
  });
});
