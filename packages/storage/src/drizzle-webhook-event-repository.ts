import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import type { PaymentId, ProviderId } from "@hookx/domain";
import type { NormalizedWebhookEvent, WebhookIdentity } from "@hookx/webhook";
import { StorageError } from "./errors.js";
import { toInsertValues, toStoredWebhookEvent } from "./mapping.js";
import type { WebhookEventRepository, WebhookListFilter } from "./repository.js";
import { webhookEvents } from "./schema/webhook-events.js";
import { isUuid, likeContains } from "./sql-search.js";
import type { WebhookProcessingStatus } from "./status.js";
import type { StoredWebhookEvent, StoreWebhookEventResult } from "./types.js";
import { WEBHOOK_LIST_LIMIT } from "./webhook-list.js";

type StorageDatabase = ReturnType<typeof drizzle>;

const FROM_PROCESSING: readonly WebhookProcessingStatus[] = ["RECEIVED"];
const FROM_PROCESSED: readonly WebhookProcessingStatus[] = ["PROCESSING"];
const FROM_REJECTED: readonly WebhookProcessingStatus[] = ["PROCESSING"];
const FROM_CONFLICT: readonly WebhookProcessingStatus[] = [
  "RECEIVED",
  "PROCESSING",
  "REJECTED",
  "CONFLICT",
];

export class DrizzleWebhookEventRepository implements WebhookEventRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async store(
    event: NormalizedWebhookEvent,
  ): Promise<StoreWebhookEventResult> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values(toInsertValues(event, "RECEIVED"))
        .onConflictDoNothing({
          target: [webhookEvents.provider, webhookEvents.externalEventId],
        })
        .returning();

      const created = inserted[0];
      if (created !== undefined) {
        return {
          outcome: "STORED",
          record: toStoredWebhookEvent(created),
        };
      }

      const existing = await tx
        .select()
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.provider, event.provider),
            eq(webhookEvents.externalEventId, event.externalEventId),
          ),
        )
        .limit(1);

      const row = existing[0];
      if (row === undefined) {
        throw new StorageError(
          "INCONSISTENT_IDENTITY",
          "Unique constraint prevented insert but no existing event was found",
        );
      }

      const record = toStoredWebhookEvent(row);
      if (row.payloadHash === event.payloadHash) {
        return {
          outcome: "DUPLICATE",
          record,
        };
      }

      return {
        outcome: "CONFLICT",
        existing: record,
        incoming: event,
      };
    });
  }

  public async findByIdentity(
    identity: WebhookIdentity,
  ): Promise<StoredWebhookEvent | null> {
    const rows = await this.db
      .select()
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, identity.provider),
          eq(webhookEvents.externalEventId, identity.externalEventId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toStoredWebhookEvent(row);
  }

  public async findById(id: string): Promise<StoredWebhookEvent | null> {
    const rows = await this.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toStoredWebhookEvent(row);
  }

  public async list(
    filter?: WebhookListFilter,
  ): Promise<readonly StoredWebhookEvent[]> {
    const clauses: SQL[] = [];
    if (filter?.provider !== undefined) {
      clauses.push(eq(webhookEvents.provider, filter.provider));
    }
    if (filter?.paymentId !== undefined) {
      clauses.push(eq(webhookEvents.paymentId, filter.paymentId));
    }
    if (filter?.eventType !== undefined) {
      clauses.push(eq(webhookEvents.eventType, filter.eventType));
    }
    if (filter?.processingStatus !== undefined) {
      clauses.push(eq(webhookEvents.processingStatus, filter.processingStatus));
    }
    if (filter?.q !== undefined) {
      const q = filter.q;
      const pattern = likeContains(q);
      const search = isUuid(q)
        ? or(
            eq(webhookEvents.id, q),
            like(webhookEvents.externalEventId, pattern),
            like(webhookEvents.paymentId, pattern),
          )
        : or(
            like(webhookEvents.externalEventId, pattern),
            like(webhookEvents.paymentId, pattern),
          );
      if (search !== undefined) {
        clauses.push(search);
      }
    }
    const query =
      clauses.length === 0
        ? this.db.select().from(webhookEvents)
        : this.db
            .select()
            .from(webhookEvents)
            .where(and(...clauses));
    const rows = await query
      .orderBy(desc(webhookEvents.receivedAt), desc(webhookEvents.id))
      .limit(WEBHOOK_LIST_LIMIT);
    return rows.map((row) => toStoredWebhookEvent(row));
  }

  public async listByPayment(
    provider: ProviderId,
    paymentId: PaymentId,
  ): Promise<readonly StoredWebhookEvent[]> {
    const rows = await this.db
      .select()
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, provider),
          eq(webhookEvents.paymentId, paymentId),
        ),
      );
    return rows.map((row) => toStoredWebhookEvent(row));
  }

  public async markProcessing(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, FROM_PROCESSING, "PROCESSING");
  }

  public async markProcessed(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, FROM_PROCESSED, "PROCESSED");
  }

  public async markRejected(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, FROM_REJECTED, "REJECTED");
  }

  public async markConflict(id: string): Promise<StoredWebhookEvent> {
    return this.transition(id, FROM_CONFLICT, "CONFLICT");
  }

  private async transition(
    id: string,
    from: readonly WebhookProcessingStatus[],
    to: WebhookProcessingStatus,
  ): Promise<StoredWebhookEvent> {
    const current = await this.findById(id);
    if (current === null) {
      throw new StorageError("EVENT_NOT_FOUND", "Webhook event was not found");
    }
    if (current.processingStatus === to && from.includes(current.processingStatus)) {
      return current;
    }
    if (!from.includes(current.processingStatus)) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        `Cannot move webhook event to ${to}`,
      );
    }

    const updated = await this.db.transaction(async (tx) => {
      return tx
        .update(webhookEvents)
        .set({ processingStatus: to })
        .where(
          and(
            eq(webhookEvents.id, id),
            inArray(webhookEvents.processingStatus, [...from]),
          ),
        )
        .returning();
    });

    const row = updated[0];
    if (row === undefined) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        `Cannot move webhook event to ${to}`,
      );
    }
    return toStoredWebhookEvent(row);
  }
}
