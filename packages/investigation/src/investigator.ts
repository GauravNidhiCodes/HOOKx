import type { InvestigationContext } from "./context.js";
import type { InvestigationResult } from "./result.js";

/**
 * Read-only investigator. Implementations must not receive database writers,
 * payment mutators, provider credentials (except an optional LLM API key
 * isolated inside the adapter), HTTP clients for payment providers, or shell
 * access.
 *
 * investigate() accepts InvestigationInput (an evidence package). The
 * application never passes ORM clients or mutation methods.
 */
export interface Investigator {
  readonly implementation: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  investigate(input: InvestigationContext): Promise<InvestigationResult>;
}
