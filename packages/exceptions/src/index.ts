export {
  EXCEPTION_CODES,
  isExceptionCode,
  type ExceptionCode,
} from "./codes.js";
export {
  EXCEPTION_SEVERITIES,
  EXCEPTION_SEVERITY_BY_CODE,
  isExceptionSeverity,
  severityForExceptionCode,
  type ExceptionSeverity,
} from "./severity.js";
export {
  EXCEPTION_STATUSES,
  canTransitionExceptionStatus,
  isExceptionStatus,
  type ExceptionStatus,
} from "./status.js";
export {
  EXCEPTION_PRECEDENCE,
  compareExceptionCode,
  exceptionPrecedenceRank,
} from "./precedence.js";
export { exceptionIdentity } from "./identity.js";
export { uniqueMissingPrerequisite } from "./missing-prerequisite.js";
export {
  createException,
  createExceptionDraft,
  type ExceptionDraft,
  type ExceptionDraftInput,
  type ExceptionMetadata,
  type ExceptionRecord,
  type NewExceptionRecord,
} from "./exception.js";
export {
  factsFromFailureCode,
  factsFromReplayDecision,
  factsFromRetryOutcome,
  factsFromStoreOutcome,
  factsFromVerificationStatus,
  factsFromWebhookErrorCode,
  type DetectionFact,
} from "./facts.js";
export {
  detectException,
  detectExceptions,
  type DetectionContext,
  type ExceptionDetectionResult,
} from "./detect.js";
