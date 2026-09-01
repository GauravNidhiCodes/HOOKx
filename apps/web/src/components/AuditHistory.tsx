import type { PublicAuditEvent } from "../api/types";
import { formatClock } from "../lib/format";
import { CopyButton } from "./CopyButton";

export function AuditHistory({
  events,
  emptyLabel = "No audit rows.",
}: {
  readonly events: readonly PublicAuditEvent[];
  readonly emptyLabel?: string;
}) {
  if (events.length === 0) {
    return <p>{emptyLabel}</p>;
  }
  return (
    <>
      <p className="advisory">
        APPEND-ONLY AUDIT HISTORY — RECORDS ARE NOT EDITED OR DELETED
      </p>
      <ol className="audit">
        {events.map((event) => (
          <li key={event.auditEventId}>
            <time className="mono" dateTime={event.recordedAt} title={event.recordedAt}>
              {formatClock(event.recordedAt)}
            </time>
            <p>
              <span className="mono">{event.actor}</span>
              {" · "}
              <span className="mono">{event.eventType}</span>
            </p>
            <p className="mono">{event.reason}</p>
            <p className="copyable">
              <span className="mono muted-id">{event.correlationId}</span>
              <CopyButton value={event.correlationId} label="correlation ID" />
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}
