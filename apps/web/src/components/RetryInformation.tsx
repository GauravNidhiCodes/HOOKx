import type { PublicDeadLetter, PublicRetry } from "../api/types";
import { blank, formatClock } from "../lib/format";
import { SpecList } from "./chrome";

export function RetryInformation({
  retry,
  deadLetter,
}: {
  readonly retry: PublicRetry | null;
  readonly deadLetter: PublicDeadLetter | null;
}) {
  if (retry === null && deadLetter === null) {
    return <p>No retry schedule is stored for this webhook.</p>;
  }
  return (
    <SpecList
      rows={[
        {
          label: "Attempt",
          value:
            retry !== null
              ? String(retry.attemptCount)
              : blank(
                  deadLetter?.attemptCount !== undefined
                    ? String(deadLetter.attemptCount)
                    : null,
                ),
        },
        {
          label: "Maximum attempts",
          value: retry !== null ? String(retry.maxAttempts) : "—",
        },
        {
          label: "Last failure",
          value: retry?.lastErrorCode ?? deadLetter?.failureCode ?? "—",
        },
        {
          label: "Next retry",
          value:
            retry?.nextAttemptAt !== null && retry?.nextAttemptAt !== undefined
              ? formatClock(retry.nextAttemptAt)
              : "—",
        },
        {
          label: "Current processing status",
          value: retry?.status ?? "DEAD_LETTERED",
        },
        {
          label: "Failed at",
          value:
            retry?.lastFailedAt !== null && retry?.lastFailedAt !== undefined
              ? formatClock(retry.lastFailedAt)
              : deadLetter !== null
                ? formatClock(deadLetter.deadLetteredAt)
                : "—",
        },
      ]}
    />
  );
}
