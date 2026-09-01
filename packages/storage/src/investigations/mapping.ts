import {
  createInvestigationRecord,
  createInvestigationResult,
  type InvestigationRecord,
} from "@hookx/investigation";
import { StorageError } from "../errors.js";
import { instantFromDate } from "../mapping.js";

export type InvestigationPersistenceRow = {
  readonly id: string;
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly result: unknown;
  readonly createdAt: Date;
  readonly correlationId: string;
};

export function toInvestigationRecord(
  row: InvestigationPersistenceRow,
): InvestigationRecord {
  try {
    return createInvestigationRecord({
      investigationId: row.id,
      exceptionId: row.exceptionId,
      investigator: row.investigator,
      modelId: row.modelId,
      promptVersion: row.promptVersion,
      result: createInvestigationResult(row.result),
      createdAt: instantFromDate(row.createdAt),
      correlationId: row.correlationId,
    });
  } catch {
    throw new StorageError("INVALID_ROW", "Stored investigation row is invalid");
  }
}
