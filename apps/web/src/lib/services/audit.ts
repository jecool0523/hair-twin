import "server-only";
import type { AuditAction } from "../domain/types";
import { getStore, newId } from "../store";

/** Append a sensitive-action audit event (system-design §5, §9). */
export async function audit(
  sessionId: string,
  action: AuditAction,
  actorId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getStore().appendAudit({
    id: newId("audit"),
    sessionId,
    action,
    actorId,
    detail,
    createdAt: new Date().toISOString(),
  });
}
