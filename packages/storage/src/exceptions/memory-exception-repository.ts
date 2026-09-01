import { randomUUID } from "node:crypto";
import {
  canTransitionExceptionStatus,
  createException,
  type ExceptionDraft,
  type ExceptionRecord,
  type ExceptionStatus,
} from "@hookx/exceptions";
import type { PaymentId } from "@hookx/domain";
import { StorageError } from "../errors.js";
import type {
  ExceptionCreateResult,
  ExceptionListFilter,
  ExceptionRepository,
} from "./repository.js";

function matchesFilter(
  row: ExceptionRecord,
  filter: ExceptionListFilter | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter.status !== undefined && row.status !== filter.status) {
    return false;
  }
  if (filter.severity !== undefined && row.severity !== filter.severity) {
    return false;
  }
  if (
    filter.exceptionCode !== undefined &&
    row.exceptionCode !== filter.exceptionCode
  ) {
    return false;
  }
  if (filter.provider !== undefined && row.provider !== filter.provider) {
    return false;
  }
  return true;
}

function compareDetected(left: ExceptionRecord, right: ExceptionRecord): number {
  if (left.detectedAt < right.detectedAt) {
    return -1;
  }
  if (left.detectedAt > right.detectedAt) {
    return 1;
  }
  return left.exceptionId < right.exceptionId
    ? -1
    : left.exceptionId > right.exceptionId
      ? 1
      : 0;
}

export class MemoryExceptionRepository implements ExceptionRepository {
  public readonly records: ExceptionRecord[] = [];

  public async create(draft: ExceptionDraft): Promise<ExceptionCreateResult> {
    const existing = this.records.find((row) => row.identity === draft.identity);
    if (existing !== undefined) {
      return { record: existing, inserted: false };
    }
    const created = createException({
      ...draft,
      exceptionId: randomUUID(),
    });
    this.records.push(created);
    return { record: created, inserted: true };
  }

  public async findById(exceptionId: string): Promise<ExceptionRecord | null> {
    return this.records.find((row) => row.exceptionId === exceptionId) ?? null;
  }

  public async findByIdentity(identity: string): Promise<ExceptionRecord | null> {
    return this.records.find((row) => row.identity === identity) ?? null;
  }

  public async list(
    filter?: ExceptionListFilter,
  ): Promise<readonly ExceptionRecord[]> {
    return this.records
      .filter((row) => matchesFilter(row, filter))
      .slice()
      .sort(compareDetected);
  }

  public async listByPayment(
    paymentId: PaymentId,
  ): Promise<readonly ExceptionRecord[]> {
    return this.records
      .filter((row) => row.paymentId === paymentId)
      .slice()
      .sort(compareDetected);
  }

  public async listOpen(): Promise<readonly ExceptionRecord[]> {
    return this.list({ status: "OPEN" });
  }

  public async updateStatus(
    exceptionId: string,
    status: ExceptionStatus,
  ): Promise<ExceptionRecord> {
    const index = this.records.findIndex((row) => row.exceptionId === exceptionId);
    const current = this.records[index];
    if (current === undefined) {
      throw new StorageError("EVENT_NOT_FOUND", "Exception was not found");
    }
    if (!canTransitionExceptionStatus(current.status, status)) {
      throw new StorageError(
        "INVALID_STATUS_TRANSITION",
        `Cannot move exception from ${current.status} to ${status}`,
      );
    }
    if (current.status === status) {
      return current;
    }
    const next = createException({
      ...current,
      status,
      detectedAt: current.detectedAt,
    });
    this.records[index] = next;
    return next;
  }
}
