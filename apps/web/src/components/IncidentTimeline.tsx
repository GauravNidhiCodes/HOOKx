import { formatClock } from "../lib/format";
import type { PublicIncidentTimelineItem } from "../api/types";
import { Link } from "../routing/router";

function lifecycleLabel(lifecycle: string): string {
  return lifecycle.replaceAll("_", " ");
}

export function IncidentTimeline({
  items,
}: {
  readonly items: readonly PublicIncidentTimelineItem[];
}) {
  if (items.length === 0) {
    return <p>No persisted timeline exists for this incident.</p>;
  }
  return (
    <ol className="incident-timeline">
      {items.map((item) => (
        <li
          key={`${item.seq}-${item.sourceId}-${item.lifecycle}`}
          className={
            item.replay !== null
              ? "incident-timeline__item incident-timeline__item--replay"
              : "incident-timeline__item"
          }
        >
          <time className="mono" dateTime={item.clock} title={item.clock}>
            {formatClock(item.clock)}
          </time>
          <p className="mono incident-timeline__label">
            {lifecycleLabel(item.lifecycle)}
            {item.inferred ? " · inferred" : null}
          </p>
          {item.decision !== null ? (
            <p className="incident-timeline__decision">{item.decision}</p>
          ) : null}
          {item.eventTime !== null || item.receivedTime !== null ? (
            <p className="incident-timeline__times">
              {item.eventTime !== null ? (
                <span>
                  EVENT TIME {formatClock(item.eventTime)}
                </span>
              ) : null}
              {item.eventTime !== null && item.receivedTime !== null ? (
                <span aria-hidden="true"> · </span>
              ) : null}
              {item.receivedTime !== null ? (
                <span>
                  RECEIVED TIME {formatClock(item.receivedTime)}
                </span>
              ) : null}
            </p>
          ) : null}
          {item.previousState !== null || item.resultingState !== null ? (
            <p className="state-shift">
              <span>{item.previousState ?? "NONE"}</span>
              <span aria-hidden="true"> → </span>
              <span>{item.resultingState ?? "NONE"}</span>
            </p>
          ) : null}
          {item.retry !== null ? (
            <p className="incident-timeline__retry">
              ATTEMPT {item.retry.attempt ?? "—"}
              {item.retry.scheduledAt !== null
                ? ` · SCHEDULED ${formatClock(item.retry.scheduledAt)}`
                : ""}
              {item.retry.attemptedAt !== null
                ? ` · ATTEMPTED ${formatClock(item.retry.attemptedAt)}`
                : ""}
              {item.retry.result !== null ? ` · ${item.retry.result}` : ""}
              {item.retry.failureClass !== null
                ? ` · ${item.retry.failureClass}`
                : ""}
            </p>
          ) : null}
          {item.replay !== null ? (
            <p className="incident-timeline__replay">
              REPLAY {item.replay.replayId} · {item.replay.trigger}
              {` · EVENTS ${String(item.replay.eventsConsidered)}`}
            </p>
          ) : null}
          {item.paymentId !== null ? (
            <p>
              <Link href={`/payments/${encodeURIComponent(item.paymentId)}`}>
                Payment {item.paymentId}
              </Link>
            </p>
          ) : null}
          {item.eventId !== null ? (
            <p>
              <Link href={`/events/${encodeURIComponent(item.eventId)}`}>
                Event {item.eventId}
              </Link>
            </p>
          ) : null}
          {item.exceptionId !== null ? (
            <p>
              <Link href={`/exceptions/${encodeURIComponent(item.exceptionId)}`}>
                Exception {item.exceptionId}
              </Link>
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
