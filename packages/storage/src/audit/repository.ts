import type { PaymentId, ProviderId } from "@hookx/domain";
import type { AuditEvent, NewAuditEvent } from "@hookx/audit";
import type { StoredPayment } from "../payment/types.js";

export type AuditAppendInput = Omit<NewAuditEvent, "auditEventId">;

export interface AuditRepository {
  append(input: AuditAppendInput): Promise<AuditEvent>;
  listByPayment(
    paymentId: PaymentId,
    provider?: ProviderId,
  ): Promise<readonly AuditEvent[]>;
  listByWebhook(webhookEventId: string): Promise<readonly AuditEvent[]>;
  listByCorrelationId(correlationId: string): Promise<readonly AuditEvent[]>;
  count(): Promise<number>;
  countByEventType(): Promise<Readonly<Record<string, number>>>;
}

export type WebhookTerminalStatus = "PROCESSED" | "REJECTED" | "CONFLICT";

export type PersistOutcomeFn = (
  webhookEventId: string,
  status: WebhookTerminalStatus,
  drafts: readonly AuditAppendInput[],
  payment?: StoredPayment | null,
) => Promise<void>;
