import type { PaymentState } from "@hookx/domain";
import {
  eventIdentityKey,
  type NormalizedWebhookEvent,
  type WebhookIdentityKey,
} from "@hookx/webhook";
import {
  lookupTransition,
  type PaymentRecordState,
} from "./transition-table.js";

export type ApplyEventInput = {
  readonly event: NormalizedWebhookEvent;
  readonly currentState: PaymentRecordState;
  readonly seenIdentityKeys: ReadonlySet<WebhookIdentityKey>;
};

export type ApplyEventResult =
  | {
      readonly outcome: "ACCEPTED";
      readonly from: PaymentRecordState;
      readonly to: PaymentState;
    }
  | {
      readonly outcome: "IGNORED_DUPLICATE";
      readonly identityKey: WebhookIdentityKey;
    }
  | {
      readonly outcome: "REJECTED";
      readonly reason: "INVALID_TRANSITION";
      readonly from: PaymentRecordState;
      readonly eventType: NormalizedWebhookEvent["eventType"];
    };

export function applyWebhookEvent(input: ApplyEventInput): ApplyEventResult {
  const identityKey = eventIdentityKey(input.event);

  if (input.seenIdentityKeys.has(identityKey)) {
    return {
      outcome: "IGNORED_DUPLICATE",
      identityKey,
    };
  }

  const to = lookupTransition(input.currentState, input.event.eventType);
  if (to === null) {
    return {
      outcome: "REJECTED",
      reason: "INVALID_TRANSITION",
      from: input.currentState,
      eventType: input.event.eventType,
    };
  }

  return {
    outcome: "ACCEPTED",
    from: input.currentState,
    to,
  };
}
