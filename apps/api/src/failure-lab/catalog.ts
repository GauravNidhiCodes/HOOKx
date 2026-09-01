export const FAILURE_LAB_SCENARIO = {
  DUPLICATE_DELIVERY: "DUPLICATE_DELIVERY",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  CONFLICTING_EVENT: "CONFLICTING_EVENT",
  TRANSIENT_FAILURE: "TRANSIENT_FAILURE",
  RETRY_EXHAUSTION: "RETRY_EXHAUSTION",
  REPLAY_RECOVERY: "REPLAY_RECOVERY",
} as const;

export type FailureLabScenarioId =
  (typeof FAILURE_LAB_SCENARIO)[keyof typeof FAILURE_LAB_SCENARIO];

export const FAILURE_LAB_SCENARIO_IDS = Object.freeze([
  FAILURE_LAB_SCENARIO.DUPLICATE_DELIVERY,
  FAILURE_LAB_SCENARIO.OUT_OF_ORDER,
  FAILURE_LAB_SCENARIO.CONFLICTING_EVENT,
  FAILURE_LAB_SCENARIO.TRANSIENT_FAILURE,
  FAILURE_LAB_SCENARIO.RETRY_EXHAUSTION,
  FAILURE_LAB_SCENARIO.REPLAY_RECOVERY,
] as const);

export function isFailureLabScenarioId(
  value: string,
): value is FailureLabScenarioId {
  return (FAILURE_LAB_SCENARIO_IDS as readonly string[]).includes(value);
}

export const SYNTHETIC_FAILURE_MODES = ["NONE", "FAIL_ONCE", "ALWAYS_FAIL"] as const;
export type SyntheticFailureMode = (typeof SYNTHETIC_FAILURE_MODES)[number];

export type FailureLabScenarioCatalogEntry = {
  readonly id: FailureLabScenarioId;
  readonly number: string;
  readonly title: string;
  readonly explanation: string;
  readonly expected: string;
  readonly failureMode: SyntheticFailureMode;
  readonly architectureDemo?: true;
};

export const ARCHITECTURE_DEMO_SCENARIO =
  FAILURE_LAB_SCENARIO.TRANSIENT_FAILURE;

export const FAILURE_LAB_NOTICE =
  "The Failure Lab never sends real payment requests.";

export const FAILURE_LAB_CATALOG: readonly FailureLabScenarioCatalogEntry[] =
  Object.freeze([
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.DUPLICATE_DELIVERY,
      number: "01",
      title: "DUPLICATE DELIVERY",
      explanation:
        "One synthetic webhook is signed once and posted twice through ingest.",
      expected:
        "First delivery accepted, persisted, processed. Second classified duplicate. One state transition.",
      failureMode: "NONE",
    }),
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.OUT_OF_ORDER,
      number: "02",
      title: "OUT-OF-ORDER DELIVERY",
      explanation:
        "Created, captured, then authorized. Capture is earlier in event time than it is in delivery order.",
      expected:
        "Capture delayed. Authorization accepted. Replay reaches CAPTURED. No invented transition.",
      failureMode: "NONE",
    }),
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.CONFLICTING_EVENT,
      number: "03",
      title: "CONFLICTING EVENT",
      explanation:
        "Same event identity is delivered again with a different amount hash.",
      expected:
        "CONFLICTING_EVENT. Original row unchanged. Conflicting payload not stored.",
      failureMode: "NONE",
    }),
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.TRANSIENT_FAILURE,
      number: "04",
      title: "TRANSIENT FAILURE",
      explanation:
        "A signed synthetic payment webhook is delivered through ingest. Lab-only FAIL_ONCE injection causes the first processing attempt to fail. Production ingest is not used.",
      expected:
        "HOOKX verifies, normalizes, and persists the event; records the failure; schedules a retry; retries; recovers payment state; records an incident and an audit trail.",
      failureMode: "FAIL_ONCE",
      architectureDemo: true,
    }),
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.RETRY_EXHAUSTION,
      number: "05",
      title: "RETRY EXHAUSTION",
      explanation:
        "Lab-only ALWAYS_FAIL injection until the configured retry policy is exhausted.",
      expected: "Retries continue until max attempts, then dead-letter.",
      failureMode: "ALWAYS_FAIL",
    }),
    Object.freeze({
      id: FAILURE_LAB_SCENARIO.REPLAY_RECOVERY,
      number: "06",
      title: "REPLAY RECOVERY",
      explanation:
        "Capture arrives before authorization. The stored log is replayed when the missing event arrives.",
      expected:
        "REPLAY STARTED, delayed capture applied, final CAPTURED, no duplicate created event.",
      failureMode: "NONE",
    }),
  ]);

export function failureLabCatalogEntry(
  id: FailureLabScenarioId,
): FailureLabScenarioCatalogEntry {
  const entry = FAILURE_LAB_CATALOG.find((row) => row.id === id);
  if (entry === undefined) {
    throw new Error(`Unknown Failure Lab scenario: ${id}`);
  }
  return entry;
}
