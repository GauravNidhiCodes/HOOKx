import type { ExceptionCode } from "@hookx/exceptions";
import type { InvestigationRuleView } from "./context.js";

const RULES: Readonly<Record<ExceptionCode, InvestigationRuleView>> = Object.freeze({
  INVALID_SIGNATURE: Object.freeze({
    id: "RULE_INVALID_SIGNATURE",
    statement:
      "A missing, invalid, or expired signature rejects the delivery. Nothing is stored and payment state does not change.",
  }),
  MALFORMED_WEBHOOK: Object.freeze({
    id: "RULE_MALFORMED_WEBHOOK",
    statement:
      "A malformed signature header or invalid normalized payload is rejected before persistence.",
  }),
  UNSUPPORTED_EVENT: Object.freeze({
    id: "RULE_UNSUPPORTED_EVENT",
    statement:
      "An unknown provider or event name is rejected. No webhook row is stored.",
  }),
  CONFLICTING_EVENT: Object.freeze({
    id: "RULE_CONFLICTING_EVENT",
    statement:
      "Same provider and external event id with a different payload hash is CONFLICTING_EVENT. The original stored event remains authoritative and is never overwritten.",
  }),
  INVALID_STATE_TRANSITION: Object.freeze({
    id: "RULE_INVALID_STATE_TRANSITION",
    statement:
      "A state-machine or replay rejection does not force a transition. Previous payment state is unchanged.",
  }),
  PROCESSING_FAILURE: Object.freeze({
    id: "RULE_PROCESSING_FAILURE",
    statement:
      "A temporary processing failure keeps the stored event and schedules a deterministic retry.",
  }),
  RETRY_EXHAUSTED: Object.freeze({
    id: "RULE_RETRY_EXHAUSTED",
    statement:
      "When the retry budget is consumed the event is dead-lettered and retained. It is not discarded.",
  }),
  OUT_OF_ORDER_EVENT: Object.freeze({
    id: "RULE_OUT_OF_ORDER_EVENT",
    statement:
      "An event that arrives before its prerequisite is stored as delayed. It is not a permanent failure.",
  }),
  MISSING_EVENT: Object.freeze({
    id: "RULE_MISSING_EVENT",
    statement:
      "MISSING_EVENT is emitted only when the published transition table names a unique immediate predecessor. There is no timeout heuristic.",
  }),
  DUPLICATE_EVENT: Object.freeze({
    id: "RULE_DUPLICATE_EVENT",
    statement:
      "An identical redelivery is DUPLICATE_EVENT. It must not create another payment transition or economic event.",
  }),
});

export function applicableRulesFor(
  code: ExceptionCode,
): readonly InvestigationRuleView[] {
  return Object.freeze([RULES[code]]);
}
