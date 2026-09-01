import { instant } from "@hookx/domain";
import {
  signSyntheticWebhook,
  unixSecondsFromInstant,
  type SyntheticWebhookPayload,
} from "@hookx/webhook";
import { SIMULATOR_NOW, SIMULATOR_SECRET } from "./notice.js";
import type { ScenarioDefinition, ScenarioEventSpec } from "./types.js";

export type LabeledSyntheticPayload = SyntheticWebhookPayload & {
  readonly synthetic: true;
};

export type SignedDelivery = {
  readonly stepIndex: number;
  readonly eventKey: string;
  readonly eventType: string;
  readonly paymentId: string;
  readonly externalEventId: string;
  readonly kind: string;
  readonly rawBody: string;
  readonly signature: string;
  readonly synthetic: true;
};

function payloadFor(
  spec: ScenarioEventSpec,
  amountMinor: string,
): LabeledSyntheticPayload {
  return Object.freeze({
    infrastructure: "SYNTHETIC",
    synthetic: true,
    event_ref: spec.externalEventId,
    kind: spec.kind,
    entity: Object.freeze({
      payment_ref: spec.paymentId,
      booked_at: spec.bookedAt,
      money: Object.freeze({
        minor_units: amountMinor,
        ccy: spec.currency,
      }),
    }),
  });
}

function signPayload(
  payload: LabeledSyntheticPayload,
  secret: string,
  now: string,
): { readonly rawBody: string; readonly signature: string } {
  const rawBody = JSON.stringify(payload);
  const signature = signSyntheticWebhook({
    secret,
    rawBody,
    timestampSeconds: unixSecondsFromInstant(instant(now)),
  });
  return { rawBody, signature };
}

function specByKey(
  scenario: ScenarioDefinition,
  eventKey: string,
): ScenarioEventSpec {
  const spec = scenario.events.find((item) => item.key === eventKey);
  if (spec === undefined) {
    throw new Error(`Scenario ${scenario.id} has no event "${eventKey}"`);
  }
  return spec;
}

/**
 * Build signed HTTP deliveries for a scenario.
 * Identifiers and bodies are deterministic. The secret never appears in output.
 */
export function generateDeliveries(
  scenario: ScenarioDefinition,
  options: { readonly secret?: string; readonly now?: string } = {},
): readonly SignedDelivery[] {
  const secret = options.secret ?? SIMULATOR_SECRET;
  const now = options.now ?? SIMULATOR_NOW;
  const originals = new Map<string, SignedDelivery>();
  const deliveries: SignedDelivery[] = [];

  for (const [index, step] of scenario.delivery.entries()) {
    const spec = specByKey(scenario, step.eventKey);
    if (step.kind === "RESEND_IDENTICAL") {
      const original = originals.get(step.eventKey);
      if (original === undefined) {
        throw new Error(`Cannot resend "${step.eventKey}" before first send`);
      }
      deliveries.push(
        Object.freeze({
          ...original,
          stepIndex: index + 1,
          kind: step.kind,
        }),
      );
      continue;
    }

    const amount =
      step.kind === "SEND_CONFLICTING"
        ? (spec.conflictAmountMinor ?? spec.amountMinor)
        : spec.amountMinor;
    const labeled = payloadFor(spec, amount);
    const signed = signPayload(labeled, secret, now);
    const delivery: SignedDelivery = Object.freeze({
      stepIndex: index + 1,
      eventKey: spec.key,
      eventType: spec.eventType,
      paymentId: spec.paymentId,
      externalEventId: spec.externalEventId,
      kind: step.kind,
      rawBody: signed.rawBody,
      signature: signed.signature,
      synthetic: true,
    });
    if (step.kind === "SEND") {
      originals.set(step.eventKey, delivery);
    }
    deliveries.push(delivery);
  }

  return Object.freeze(deliveries);
}

export function parseLabeledPayload(rawBody: string): LabeledSyntheticPayload {
  const value: unknown = JSON.parse(rawBody);
  if (
    typeof value !== "object" ||
    value === null ||
    !("synthetic" in value) ||
    value.synthetic !== true
  ) {
    throw new Error("Simulator payload is missing synthetic: true");
  }
  return value as LabeledSyntheticPayload;
}
