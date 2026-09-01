import type { PublicException } from "../api/types";
import { formatClock, isSyntheticRef } from "../lib/format";
import { Link } from "../routing/router";

export function ExceptionLinkTable({
  exceptions,
}: {
  readonly exceptions: readonly PublicException[];
}) {
  if (exceptions.length === 0) {
    return <p>No exceptions are stored for this payment.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="queue">
        <caption className="visually-hidden">Exceptions</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Detected</th>
          </tr>
        </thead>
        <tbody>
          {exceptions.map((row) => (
            <tr key={row.exceptionId}>
              <th scope="row">
                <Link
                  href={`/exceptions/${encodeURIComponent(row.exceptionId)}`}
                  className="queue-link"
                >
                  {row.exceptionCode}
                </Link>
                {isSyntheticRef(row.provider) || isSyntheticRef(row.paymentId) ? (
                  <span className="inline-flag">SYNTHETIC</span>
                ) : null}
              </th>
              <td>{row.severity}</td>
              <td>{row.status}</td>
              <td className="mono" title={row.detectedAt}>
                {formatClock(row.detectedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
