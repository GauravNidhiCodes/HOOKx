import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import {
  createInvestigationRecord,
  type InvestigationRecord,
} from "@hookx/investigation";
import { StorageError } from "../errors.js";
import { dateFromInstant } from "../mapping.js";
import { investigations } from "../schema/investigations.js";
import { toInvestigationRecord } from "./mapping.js";
import type {
  InvestigationRepository,
  NewInvestigation,
} from "./repository.js";

type StorageDatabase = ReturnType<typeof drizzle>;

function toInsertValues(record: InvestigationRecord) {
  return {
    id: record.investigationId,
    exceptionId: record.exceptionId,
    investigator: record.investigator,
    modelId: record.modelId,
    promptVersion: record.promptVersion,
    result: record.result,
    createdAt: dateFromInstant(record.createdAt),
    correlationId: record.correlationId,
  };
}

export class DrizzleInvestigationRepository implements InvestigationRepository {
  public constructor(private readonly db: StorageDatabase) {}

  public async create(input: NewInvestigation): Promise<InvestigationRecord> {
    const created = createInvestigationRecord({
      ...input,
      investigationId: randomUUID(),
    });
    const inserted = await this.db
      .insert(investigations)
      .values(toInsertValues(created))
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new StorageError("INVALID_ROW", "Investigation insert did not return a row");
    }
    return toInvestigationRecord(row);
  }

  public async findById(
    investigationId: string,
  ): Promise<InvestigationRecord | null> {
    const rows = await this.db
      .select()
      .from(investigations)
      .where(eq(investigations.id, investigationId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toInvestigationRecord(row);
  }

  public async findLatestByExceptionId(
    exceptionId: string,
  ): Promise<InvestigationRecord | null> {
    const rows = await this.db
      .select()
      .from(investigations)
      .where(eq(investigations.exceptionId, exceptionId))
      .orderBy(desc(investigations.createdAt), desc(investigations.id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toInvestigationRecord(row);
  }

  public async listByException(
    exceptionId: string,
  ): Promise<readonly InvestigationRecord[]> {
    const rows = await this.db
      .select()
      .from(investigations)
      .where(eq(investigations.exceptionId, exceptionId))
      .orderBy(asc(investigations.createdAt), asc(investigations.id));
    return rows.map((row) => toInvestigationRecord(row));
  }
}
