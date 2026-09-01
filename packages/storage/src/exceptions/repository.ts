import type { PaymentId, ProviderId } from "@hookx/domain";
import type {
  ExceptionCode,
  ExceptionDraft,
  ExceptionRecord,
  ExceptionSeverity,
  ExceptionStatus,
} from "@hookx/exceptions";

export type ExceptionCreateResult = {
  readonly record: ExceptionRecord;
  readonly inserted: boolean;
};

export type ExceptionListFilter = {
  readonly status?: ExceptionStatus;
  readonly severity?: ExceptionSeverity;
  readonly exceptionCode?: ExceptionCode;
  readonly provider?: ProviderId;
};

export interface ExceptionRepository {
  create(draft: ExceptionDraft): Promise<ExceptionCreateResult>;
  findById(exceptionId: string): Promise<ExceptionRecord | null>;
  findByIdentity(identity: string): Promise<ExceptionRecord | null>;
  list(filter?: ExceptionListFilter): Promise<readonly ExceptionRecord[]>;
  listByPayment(paymentId: PaymentId): Promise<readonly ExceptionRecord[]>;
  listOpen(): Promise<readonly ExceptionRecord[]>;
  updateStatus(
    exceptionId: string,
    status: ExceptionStatus,
  ): Promise<ExceptionRecord>;
}
