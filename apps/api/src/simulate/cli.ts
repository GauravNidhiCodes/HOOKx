import {
  CLI_ALIAS,
  formatScenarioList,
  formatScenarioReport,
  resolveScenarioRef,
  SCENARIOS,
  SYNTHETIC_NOTICE,
} from "@hookx/simulator";
import {
  applyWebhookEventMigrations,
  defaultTestDatabaseUrl,
  openWebhookEventStore,
  recreateDatabase,
} from "@hookx/storage";
import { runScenario } from "./run-scenario.js";

function simulateDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env["HOOKX_SIMULATE_DATABASE_URL"];
  if (typeof explicit === "string" && explicit.length > 0) {
    return explicit;
  }
  const parsed = new URL(defaultTestDatabaseUrl(env));
  parsed.pathname = "/hookx_simulate";
  return parsed.toString();
}

function printHelp(): void {
  process.stdout.write(`${formatScenarioList(SCENARIOS, CLI_ALIAS)}\n`);
  process.stdout.write(
    "\nEach command posts signed synthetic webhooks to the real HTTP ingest route.\n",
  );
  process.stdout.write(`${SYNTHETIC_NOTICE}\n`);
}

async function main(argv: readonly string[]): Promise<void> {
  const arg = argv[0]?.trim() ?? "";
  if (
    arg.length === 0 ||
    arg === "--help" ||
    arg === "-h" ||
    arg === "list" ||
    arg === "--list"
  ) {
    printHelp();
    return;
  }

  const scenario = resolveScenarioRef(arg);
  const url = simulateDatabaseUrl(process.env);
  await recreateDatabase({ url });
  await applyWebhookEventMigrations({ url });
  const store = await openWebhookEventStore({ url });
  try {
    const result = await runScenario(store, scenario);
    process.stdout.write(`${formatScenarioReport(result)}\n`);
  } finally {
    await store.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "simulate failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
