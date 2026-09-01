import type { Instant } from "@hookx/domain";
import type {
  InvestigationRecord,
  InvestigationResult,
} from "@hookx/investigation";

export type NewInvestigation = {
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly result: InvestigationResult;
  readonly createdAt: Instant;
  readonly correlationId: string;
};

export interface InvestigationRepository {
  create(input: NewInvestigation): Promise<InvestigationRecord>;
  findById(investigationId: string): Promise<InvestigationRecord | null>;
  findLatestByExceptionId(
    exceptionId: string,
  ): Promise<InvestigationRecord | null>;
  listByException(exceptionId: string): Promise<readonly InvestigationRecord[]>;
}
