import type { AuditActor } from "@hookx/audit";
import type { Instant } from "@hookx/domain";
import {
  detectException,
  type DetectionContext,
  type ExceptionDetectionResult,
  type ExceptionRecord,
  type ExceptionStatus,
} from "@hookx/exceptions";
import { appendAuditDrafts } from "../audit/persist-outcome.js";
import type { AuditRepository } from "../audit/repository.js";
import {
  exceptionDetectedDraft,
  exceptionStatusChangedDraft,
} from "./audit-drafts.js";
import type { ExceptionRepository } from "./repository.js";

export async function persistDetectedExceptions(
  dependencies: {
    readonly exceptions: ExceptionRepository;
    readonly audit?: AuditRepository;
  },
  result: ExceptionDetectionResult,
  actor: AuditActor,
): Promise<readonly ExceptionRecord[]> {
  const saved: ExceptionRecord[] = [];
  for (const draft of result.exceptions) {
    const outcome = await dependencies.exceptions.create(draft);
    if (outcome.inserted) {
      if (dependencies.audit !== undefined) {
        await dependencies.audit.append(
          exceptionDetectedDraft(outcome.record, actor),
        );
      }
      saved.push(outcome.record);
    }
  }
  return saved;
}

export async function recordExceptionsSafely(
  dependencies: {
    readonly exceptions?: ExceptionRepository;
    readonly audit?: AuditRepository;
  },
  context: DetectionContext,
  actor: AuditActor,
): Promise<readonly ExceptionRecord[]> {
  if (dependencies.exceptions === undefined) {
    return [];
  }
  try {
    const result = detectException(context);
    if (result.exceptions.length === 0) {
      return [];
    }
    return await persistDetectedExceptions(
      {
        exceptions: dependencies.exceptions,
        audit: dependencies.audit,
      },
      result,
      actor,
    );
  } catch {
    // Exception persistence must not change ingest or retry HTTP/worker outcomes.
    return [];
  }
}

export async function changeExceptionStatus(
  dependencies: {
    readonly exceptions: ExceptionRepository;
    readonly audit?: AuditRepository;
  },
  exceptionId: string,
  status: ExceptionStatus,
  actor: AuditActor,
  recordedAt: Instant,
): Promise<ExceptionRecord> {
  const updated = await dependencies.exceptions.updateStatus(
    exceptionId,
    status,
  );
  if (dependencies.audit !== undefined) {
    await appendAuditDrafts(dependencies.audit, [
      exceptionStatusChangedDraft(updated, actor, recordedAt),
    ]);
  }
  return updated;
}
