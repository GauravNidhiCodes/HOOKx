import type { PublicIncident } from "../api/types";
import { Link } from "../routing/router";
import { blank, formatClock } from "../lib/format";

export function IncidentRow({ incident }: { readonly incident: PublicIncident }) {
  return (
    <tr className={`queue-row queue-row--${incident.severity.toLowerCase()}`}>
      <th scope="row">
        <Link
          href={`/incidents/${encodeURIComponent(incident.incidentId)}`}
          className="queue-link"
        >
          {incident.exceptionCode}
        </Link>
        {incident.synthetic ? <span className="inline-flag">SYNTHETIC</span> : null}
      </th>
      <td className="mono">{blank(incident.paymentId)}</td>
      <td className="mono">{blank(incident.provider)}</td>
      <td className="mono">{blank(incident.eventId)}</td>
      <td className="severity">{incident.severity}</td>
      <td>{incident.status}</td>
      <td className="mono" title={incident.detectedAt}>
        {formatClock(incident.detectedAt)}
      </td>
    </tr>
  );
}
