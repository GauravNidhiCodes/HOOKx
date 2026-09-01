import { formatClock } from "../lib/format";
import type { PublicIncidentTimelineItem } from "../api/types";
import { Link } from "../routing/router";

function lifecycleLabel(lifecycle: string): string {
  return lifecycle.replaceAll("_", " ");
}

function timelineResult(item: PublicIncidentTimelineItem): string {
  if (item.retry?.result !== null && item.retry?.result !== undefined) {
    return item.retry.result;
  }
  if (item.decision !== null) {
    return item.decision;
  }
  if (item.resultingState !== null) {
    return `${item.previousState ?? "NONE"} → ${item.resultingState}`;
  }
  if (item.replay !== null) {
    return item.replay.trigger;
  }
  return "—";
}

function hasTechnicalDetail(item: PublicIncidentTimelineItem): boolean {
  return (
    item.eventTime !== null ||
    item.receivedTime !== null ||
    item.processedTime !== null ||
    item.retry !== null ||
    item.replay !== null ||
    item.paymentId !== null ||
    item.eventId !== null ||
    item.exceptionId !== null
  );
}

export function IncidentTimeline({
  items,
}: {
  readonly items: readonly PublicIncidentTimelineItem[];
}) {
  if (items.length === 0) {
    return (
      <section className="empty">
        <h2 className="kicker">NO TIMELINE</h2>
        <p>No persisted timeline exists for this incident.</p>
      </section>
    );
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
          <div className="timeline-row">
            <time
              className="timeline-row__time"
              dateTime={item.clock}
              title={item.clock}
            >
              {formatClock(item.clock)}
            </time>
            <p className="timeline-row__event">
              {lifecycleLabel(item.lifecycle)}
              {item.inferred ? " · inferred" : null}
            </p>
            <p className="timeline-row__result">{timelineResult(item)}</p>
          </div>
          {hasTechnicalDetail(item) ? (
            <details className="payload">
              <summary>TECHNICAL DETAILS</summary>
              {item.eventTime !== null ||
              item.receivedTime !== null ||
              item.processedTime !== null ? (
                <p className="incident-timeline__times">
                  {item.eventTime !== null ? (
                    <span>EVENT TIME {formatClock(item.eventTime)}</span>
                  ) : null}
                  {item.eventTime !== null && item.receivedTime !== null ? (
                    <span aria-hidden="true"> · </span>
                  ) : null}
                  {item.receivedTime !== null ? (
                    <span>RECEIVED TIME {formatClock(item.receivedTime)}</span>
                  ) : null}
                  {(item.eventTime !== null || item.receivedTime !== null) &&
                  item.processedTime !== null ? (
                    <span aria-hidden="true"> · </span>
                  ) : null}
                  {item.processedTime !== null ? (
                    <span>PROCESSED TIME {formatClock(item.processedTime)}</span>
                  ) : null}
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
                  <Link
                    href={`/exceptions/${encodeURIComponent(item.exceptionId)}`}
                  >
                    Exception {item.exceptionId}
                  </Link>
                </p>
              ) : null}
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
