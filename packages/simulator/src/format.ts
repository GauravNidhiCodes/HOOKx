import { SYNTHETIC_NOTICE } from "./notice.js";
import type { ScenarioDefinition } from "./types.js";

export type DeliveryReport = {
  readonly stepIndex: number;
  readonly eventType: string;
  readonly paymentId: string;
  readonly httpStatus: number;
  readonly bodyStatus: string;
  readonly code?: string;
  readonly note?: string;
};

export type PaymentReport = {
  readonly paymentId: string;
  readonly state: string | null;
};

export type ScenarioRunView = {
  readonly scenario: ScenarioDefinition;
  readonly deliveries: readonly DeliveryReport[];
  readonly payments: readonly PaymentReport[];
};

function padIndex(index: number): string {
  return String(index);
}

/**
 * Terminal summary for demos. No secrets, no raw payloads, no fake metrics.
 */
export function formatScenarioReport(view: ScenarioRunView): string {
  const { scenario, deliveries, payments } = view;
  const paymentLine =
    payments.length === 1
      ? `Payment: ${payments[0]?.paymentId ?? scenario.paymentIds[0]}`
      : `Payments: ${scenario.paymentIds.join(", ")}`;

  const delivered = deliveries
    .map((row) => {
      const code = row.code === undefined ? "" : ` (${row.code})`;
      const note = row.note === undefined ? "" : ` — ${row.note}`;
      return `${padIndex(row.stepIndex)}. ${row.eventType}  → ${row.bodyStatus}${code}${note}`;
    })
    .join("\n");

  const results = scenario.expected.resultLines
    .map((line) => `- ${line}`)
    .join("\n");

  const observed = payments
    .map(
      (row) =>
        `- ${row.paymentId}: ${row.state === null ? "(no payment record)" : row.state}`,
    )
    .join("\n");

  return [
    "HOOKX synthetic webhook simulator",
    SYNTHETIC_NOTICE,
    "",
    `Scenario: ${scenario.id}`,
    paymentLine,
    scenario.description,
    "",
    "Delivered:",
    delivered,
    "",
    "Result:",
    results,
    "",
    "Observed payment state:",
    observed,
  ].join("\n");
}

export function formatScenarioList(
  scenarios: readonly ScenarioDefinition[],
  aliases: Readonly<Record<string, string>>,
): string {
  const lines = [
    "HOOKX synthetic webhook simulator",
    SYNTHETIC_NOTICE,
    "",
    "Commands:",
  ];
  for (const [alias, id] of Object.entries(aliases)) {
    const scenario = scenarios.find((item) => item.id === id);
    lines.push(`  pnpm simulate ${alias}`);
    if (scenario !== undefined) {
      lines.push(`    ${scenario.description}`);
    }
  }
  return lines.join("\n");
}
