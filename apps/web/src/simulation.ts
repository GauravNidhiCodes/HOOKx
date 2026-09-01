/**
 * Shared labels for a future operator UI.
 * The simulator itself is CLI-only. These IDs are not live payment-provider events.
 */
export const SYNTHETIC_SCENARIO_IDS = [
  "NORMAL_FLOW",
  "DUPLICATE_DELIVERY",
  "OUT_OF_ORDER",
  "CONFLICT",
  "RETRY_FAILURE",
  "PERMANENT_FAILURE",
  "MULTI_PAYMENT",
] as const;

export type SyntheticScenarioId = (typeof SYNTHETIC_SCENARIO_IDS)[number];

export const SYNTHETIC_EVENT_NOTICE =
  "All simulator events are synthetic and do not represent real payment transactions.";
