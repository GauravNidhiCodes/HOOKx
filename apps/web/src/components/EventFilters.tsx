import type { FormEvent } from "react";
import type { EventListFilter } from "../lib/event-filter";
import {
  OPERATOR_EVENT_TYPES,
  OPERATOR_PROCESSING_STATUSES,
} from "../lib/operator-catalog";

export function EventFilters({
  value,
  onSubmit,
  searchLabel = "External event ID",
  includePaymentSearch = false,
}: {
  readonly value: EventListFilter;
  readonly onSubmit: (next: EventListFilter) => void;
  readonly searchLabel?: string;
  readonly includePaymentSearch?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" ? raw.trim() : "";
    };
    onSubmit({
      eventType: read("eventType"),
      processingStatus: read("processingStatus"),
      q: read("q"),
    });
  }

  return (
    <form className="filters" onSubmit={submit} aria-label="Event filters">
      <label>
        Event type
        <select name="eventType" defaultValue={value.eventType ?? ""}>
          <option value="">ALL</option>
          {OPERATOR_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Processing status
        <select
          name="processingStatus"
          defaultValue={value.processingStatus ?? ""}
        >
          <option value="">ALL</option>
          {OPERATOR_PROCESSING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="filters__search">
        {includePaymentSearch ? "Search IDs" : searchLabel}
        <input
          name="q"
          defaultValue={value.q ?? ""}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            includePaymentSearch
              ? "event, payment, or external id"
              : "external event id"
          }
        />
      </label>
      <button type="submit">Apply</button>
    </form>
  );
}
