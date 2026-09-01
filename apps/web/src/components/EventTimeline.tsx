import { formatClock } from "../lib/format";
import type { TimelineItem } from "../lib/timeline";

export function EventTimeline({ items }: { readonly items: readonly TimelineItem[] }) {
  if (items.length === 0) {
    return <p>No stored events for this exception.</p>;
  }
  return (
    <ol className="timeline">
      {items.map((item, index) => (
        <li key={`${item.at}-${item.label}-${item.result}-${String(index)}`}>
          <time className="mono" dateTime={item.at} title={item.at}>
            {formatClock(item.at)}
          </time>
          <p className="mono timeline__label">{item.label}</p>
          <p className="timeline__result">{item.result}</p>
          {item.previousState !== null || item.nextState !== null ? (
            <p className="state-shift">
              <span>{item.previousState ?? "NONE"}</span>
              <span aria-hidden="true"> → </span>
              <span>{item.nextState ?? "NONE"}</span>
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
