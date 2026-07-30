import "server-only";

export interface InviteMessage { email: string; salonId: string; role: "admin" | "stylist"; acceptUrl: string }
export interface InviteEmailProvider { send(message: InviteMessage): Promise<void> }

export class WebhookInviteEmailProvider implements InviteEmailProvider {
  constructor(private url: string, private bearer: string) {}
  async send(message: InviteMessage) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ template: "hair-twin-salon-invite", ...message }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`invite email webhook failed (${response.status})`);
  }
}

export class TestInviteEmailProvider implements InviteEmailProvider {
  readonly sent: InviteMessage[] = [];
  async send(message: InviteMessage) { this.sent.push(message); }
}

export function createInviteEmailProvider(): InviteEmailProvider {
  if (process.env.INVITE_EMAIL_PROVIDER === "webhook") {
    const url = process.env.INVITE_EMAIL_WEBHOOK_URL;
    const bearer = process.env.INVITE_EMAIL_WEBHOOK_SECRET;
    if (!url || !bearer) throw new Error("invite email webhook is not configured");
    return new WebhookInviteEmailProvider(url, bearer);
  }
  if (process.env.NODE_ENV === "test") return new TestInviteEmailProvider();
  throw new Error("INVITE_EMAIL_PROVIDER must be configured");
}
