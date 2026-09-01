import type { PublicAuditEvent } from "../api/types";
import { formatClock } from "../lib/format";

export function AuditHistory({ events }: { readonly events: readonly PublicAuditEvent[] }) {
  if (events.length === 0) {
    return <p>No audit rows for this exception.</p>;
  }
  return (
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
          <p className="mono muted-id">{event.correlationId}</p>
        </li>
      ))}
    </ol>
  );
}
