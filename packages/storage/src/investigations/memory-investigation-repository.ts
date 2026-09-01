import { randomUUID } from "node:crypto";
import {
  createInvestigationRecord,
  type InvestigationRecord,
} from "@hookx/investigation";
import type {
  InvestigationRepository,
  NewInvestigation,
} from "./repository.js";

function compareCreated(
  left: InvestigationRecord,
  right: InvestigationRecord,
): number {
  if (left.createdAt < right.createdAt) {
    return -1;
  }
  if (left.createdAt > right.createdAt) {
    return 1;
  }
  return left.investigationId < right.investigationId
    ? -1
    : left.investigationId > right.investigationId
      ? 1
      : 0;
}

export class MemoryInvestigationRepository implements InvestigationRepository {
  public readonly records: InvestigationRecord[] = [];

  public async create(input: NewInvestigation): Promise<InvestigationRecord> {
    const created = createInvestigationRecord({
      ...input,
      investigationId: randomUUID(),
    });
    this.records.push(created);
    return created;
  }

  public async findById(
    investigationId: string,
  ): Promise<InvestigationRecord | null> {
    return (
      this.records.find((row) => row.investigationId === investigationId) ??
      null
    );
  }

  public async findLatestByExceptionId(
    exceptionId: string,
  ): Promise<InvestigationRecord | null> {
    const listed = await this.listByException(exceptionId);
    return listed[listed.length - 1] ?? null;
  }

  public async listByException(
    exceptionId: string,
  ): Promise<readonly InvestigationRecord[]> {
    return this.records
      .filter((row) => row.exceptionId === exceptionId)
      .slice()
      .sort(compareCreated);
  }
}
