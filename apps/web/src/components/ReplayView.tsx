import type { ReplayView } from "../lib/replay";
import { Link } from "../routing/router";

export function ReplayVisualization({
  replay,
}: {
  readonly replay: ReplayView;
}) {
  return (
    <div className="replay">
      <p className="advisory">
        DETERMINISTIC REPLAY RESULT — NOT PRODUCED BY AI INVESTIGATION
      </p>
      <div className="replay__cols">
        <div>
          <h3 className="kicker">Original delivery order</h3>
          <ol className="replay__list">
            {replay.originalDelivery.map((row, index) => (
              <li key={`delivery-${row.webhookEventId}`}>
                <span className="mono">{index + 1}. {row.eventType}</span>
                <p className="mono">receivedAt {row.receivedAt}</p>
                <Link href={`/events/${encodeURIComponent(row.webhookEventId)}`}>
                  {row.webhookEventId}
                </Link>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="kicker">Resolved logical order</h3>
          <ol className="replay__list">
            {replay.logicalOrder.map((row, index) => (
              <li key={`logical-${row.webhookEventId}`}>
                <span className="mono">{index + 1}. {row.eventType}</span>
                <p className="mono">occurredAt {row.occurredAt}</p>
                <Link href={`/events/${encodeURIComponent(row.webhookEventId)}`}>
                  {row.webhookEventId}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="kicker">Final state</p>
      <p className="state-chain__state">{replay.finalState}</p>
    </div>
  );
}
