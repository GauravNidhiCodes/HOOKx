import type { PublicException } from "@hookx/exceptions/catalog";
import { Link } from "../routing/router";
import { blank, formatClock, isSyntheticRef } from "../lib/format";

export function ExceptionRow({ exception }: { readonly exception: PublicException }) {
  const synthetic =
    isSyntheticRef(exception.provider) || isSyntheticRef(exception.paymentId);
  return (
    <tr className={`queue-row queue-row--${exception.severity.toLowerCase()}`}>
      <th scope="row">
        <Link
          href={`/exceptions/${encodeURIComponent(exception.exceptionId)}`}
          className="queue-link"
        >
          {exception.exceptionCode}
        </Link>
        {synthetic ? <span className="inline-flag">SYNTHETIC</span> : null}
      </th>
      <td className="mono">{blank(exception.paymentId)}</td>
      <td className="mono">{blank(exception.provider)}</td>
      <td className="mono">{blank(exception.webhookEventId)}</td>
      <td className="severity">{exception.severity}</td>
      <td>{exception.status}</td>
      <td className="mono" title={exception.detectedAt}>
        {formatClock(exception.detectedAt)}
      </td>
    </tr>
  );
}
