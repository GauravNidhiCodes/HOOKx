import type { WebhookEventType } from "../event-type.js";
import { WebhookError } from "../errors.js";
import {
  isSyntheticEventName,
  SYNTHETIC_EVENT_NAME,
  type SyntheticEventName,
} from "./payload.js";

export const SYNTHETIC_EVENT_TYPE_MAP: Readonly<
  Record<SyntheticEventName, WebhookEventType>
> = Object.freeze({
  [SYNTHETIC_EVENT_NAME.PAYMENT_OPENED]: "payment.created",
  [SYNTHETIC_EVENT_NAME.PAYMENT_HOLD]: "payment.authorized",
  [SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED]: "payment.captured",
  [SYNTHETIC_EVENT_NAME.PAYMENT_DECLINED]: "payment.failed",
  [SYNTHETIC_EVENT_NAME.PAYMENT_RETURN]: "refund.created",
});

export function mapSyntheticEventType(kind: string): WebhookEventType {
  if (!isSyntheticEventName(kind)) {
    throw new WebhookError(
      "UNSUPPORTED_EVENT",
      "Provider event type is not supported",
    );
  }
  return SYNTHETIC_EVENT_TYPE_MAP[kind];
}
