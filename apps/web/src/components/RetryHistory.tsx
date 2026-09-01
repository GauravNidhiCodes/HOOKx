import type { RetryAttemptView } from "../lib/retry-history";
import { blank, formatClock } from "../lib/format";

export function RetryHistory({
  attempts,
}: {
  readonly attempts: readonly RetryAttemptView[];
}) {
  if (attempts.length === 0) {
    return <p>No retry attempts are recorded in audit history.</p>;
  }
  return (
    <ol className="retry-history">
      {attempts.map((row, index) => (
        <li key={`${row.at}-${row.result}-${String(index)}`}>
          <p className="kicker">ATTEMPT {row.attempt}</p>
          <p className="mono">{row.result}</p>
          <time className="mono" dateTime={row.at} title={row.at}>
            {formatClock(row.at)}
          </time>
          {row.failureClass !== null ? (
            <p className="mono">{row.failureClass}</p>
          ) : null}
          {row.nextRetry !== null ? (
            <p>Next retry {formatClock(row.nextRetry)}</p>
          ) : null}
          <p className="mono">{blank(row.webhookEventId)}</p>
        </li>
      ))}
    </ol>
  );
}
