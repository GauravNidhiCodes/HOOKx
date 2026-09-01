import { describe, it, expectTypeOf } from "vitest";
import type { ProcessIncomingWebhookDependencies } from "../pipeline/process-incoming-webhook.js";

type PipelineAiKeys = Extract<
  keyof ProcessIncomingWebhookDependencies,
  "investigator" | "investigations"
>;

describe("ingest path isolation", () => {
  it("does not accept an investigator on processIncomingWebhook", () => {
    expectTypeOf<PipelineAiKeys>().toEqualTypeOf<never>();
  });
});
