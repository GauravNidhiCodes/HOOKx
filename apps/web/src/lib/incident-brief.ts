import type {
  PublicIncident,
  PublicIncidentTimelineItem,
} from "../api/types";

function uniqueLifecycles(
  items: readonly PublicIncidentTimelineItem[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const label = item.lifecycle.replaceAll("_", " ");
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

export function incidentBrief(
  incident: PublicIncident,
  timeline: readonly PublicIncidentTimelineItem[] | null,
): {
  readonly what: string;
  readonly why: string;
  readonly systemDid: string;
  readonly afterward: string;
  readonly operator: string;
} {
  const payment =
    incident.paymentId === null
      ? "No payment is attached."
      : `Payment ${incident.paymentId}.`;
  const what = `${incident.exceptionCode} was recorded as an incident. ${payment}`;
  let systemDid = "Timeline is still loading.";
  if (timeline !== null) {
    systemDid =
      timeline.length === 0
        ? "No composed timeline events were persisted for this incident."
        : uniqueLifecycles(timeline).join(" → ");
  }
  const afterward = [`Incident status ${incident.status}.`];
  if (timeline !== null) {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const state = timeline[index]?.resultingState;
      if (state !== null && state !== undefined) {
        afterward.push(`Last recorded payment state ${state}.`);
        break;
      }
    }
  }
  return {
    what,
    why: incident.reason,
    systemDid,
    afterward: afterward.join(" "),
    operator:
      "Inspect the timeline, run a read-only AI investigation, or open the linked payment and event records. Investigation does not change financial state.",
  };
}
