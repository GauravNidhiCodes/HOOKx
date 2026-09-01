import {
  CONFLICT,
  DUPLICATE_DELIVERY,
  MULTI_PAYMENT,
  NORMAL_FLOW,
  OUT_OF_ORDER,
  PERMANENT_FAILURE,
  RETRY_FAILURE,
} from "./scenarios.js";
import {
  CLI_ALIAS,
  type ScenarioDefinition,
  type ScenarioId,
} from "./types.js";

export const SCENARIOS: readonly ScenarioDefinition[] = Object.freeze([
  NORMAL_FLOW,
  DUPLICATE_DELIVERY,
  OUT_OF_ORDER,
  CONFLICT,
  RETRY_FAILURE,
  PERMANENT_FAILURE,
  MULTI_PAYMENT,
]);

const BY_ID: ReadonlyMap<ScenarioId, ScenarioDefinition> = new Map(
  SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

export function getScenario(id: ScenarioId): ScenarioDefinition {
  const scenario = BY_ID.get(id);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return scenario;
}

export function resolveScenarioRef(value: string): ScenarioDefinition {
  const trimmed = value.trim();
  const alias = CLI_ALIAS[trimmed];
  if (alias !== undefined) {
    return getScenario(alias);
  }
  const match = SCENARIOS.find((row) => row.id === trimmed);
  if (match !== undefined) {
    return match;
  }
  const upper = trimmed.toUpperCase().replaceAll("-", "_");
  const upperMatch = SCENARIOS.find((row) => row.id === upper);
  if (upperMatch !== undefined) {
    return upperMatch;
  }
  throw new Error(
    `Unknown scenario "${value}". Try: ${Object.keys(CLI_ALIAS).join(", ")}`,
  );
}
