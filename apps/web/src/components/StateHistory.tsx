import { formatClock } from "../lib/format";
import type { StateTransitionView } from "../lib/state-history";
import { Link } from "../routing/router";

export function StateHistory({
  transitions,
}: {
  readonly transitions: readonly StateTransitionView[];
}) {
  if (transitions.length === 0) {
    return <p>No payment state transitions are recorded in audit history.</p>;
  }
  return (
    <ol className="state-chain">
      {transitions.map((row, index) => (
        <li key={`${row.at}-${row.nextState}-${String(index)}`}>
          {index > 0 ? (
            <p className="state-chain__arrow" aria-hidden="true">
              ↓
            </p>
          ) : null}
          <p className="state-chain__state">{row.nextState}</p>
          <p className="mono">
            {row.previousState ?? "NONE"} → {row.nextState}
          </p>
          <time className="mono" dateTime={row.at} title={row.at}>
            {formatClock(row.at)}
          </time>
          {row.eventType !== null ? (
            <p className="mono">{row.eventType}</p>
          ) : null}
          <p>{row.reason}</p>
          {row.webhookEventId !== null ? (
            <p>
              <Link href={`/events/${encodeURIComponent(row.webhookEventId)}`}>
                {row.webhookEventId}
              </Link>
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
