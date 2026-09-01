import type { PublicWebhookEvent } from "../api/types";
import { blank, formatClock, isSyntheticRef } from "../lib/format";
import { Link } from "../routing/router";

export function EventTable({
  events,
  showPayment = true,
  emptyTitle = "NO EVENTS",
  emptyBody = "No webhook events are available.",
}: {
  readonly events: readonly PublicWebhookEvent[];
  readonly showPayment?: boolean;
  readonly emptyTitle?: string;
  readonly emptyBody?: string;
}) {
  if (events.length === 0) {
    return (
      <section className="empty">
        <h2 className="kicker">{emptyTitle}</h2>
        <p>{emptyBody}</p>
      </section>
    );
  }
  return (
    <div className="table-wrap">
      <table className="queue">
        <caption className="visually-hidden">Webhook events</caption>
        <thead>
          <tr>
            <th scope="col">Event ID</th>
            {showPayment ? <th scope="col">Payment ID</th> : null}
            <th scope="col">Provider</th>
            <th scope="col">Event type</th>
            <th scope="col">occurredAt</th>
            <th scope="col">receivedAt</th>
            <th scope="col">Status</th>
            <th scope="col">Attempt</th>
          </tr>
        </thead>
        <tbody>
          {events.map((row) => {
            const synthetic =
              isSyntheticRef(row.provider) || isSyntheticRef(row.paymentId);
            return (
              <tr key={row.webhookEventId}>
                <th scope="row">
                  <Link
                    href={`/events/${encodeURIComponent(row.webhookEventId)}`}
                    className="queue-link"
                  >
                    {row.webhookEventId}
                  </Link>
                  {synthetic ? (
                    <span className="inline-flag">SYNTHETIC</span>
                  ) : null}
                </th>
                {showPayment ? (
                  <td className="mono">
                    <Link href={`/payments/${encodeURIComponent(row.paymentId)}`}>
                      {row.paymentId}
                    </Link>
                  </td>
                ) : null}
                <td className="mono">{row.provider}</td>
                <td className="mono">{row.eventType}</td>
                <td className="mono" title={row.occurredAt}>
                  {formatClock(row.occurredAt)}
                </td>
                <td className="mono" title={row.receivedAt}>
                  {formatClock(row.receivedAt)}
                </td>
                <td>{row.processingStatus}</td>
                <td className="mono">{blank(String(row.deliveryAttempt))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
