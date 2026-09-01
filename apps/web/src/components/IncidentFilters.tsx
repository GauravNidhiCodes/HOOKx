import {
  EXCEPTION_CODES,
  EXCEPTION_SEVERITIES,
  EXCEPTION_STATUSES,
} from "@hookx/exceptions/catalog";
import type { FormEvent } from "react";
import type { IncidentListQuery } from "../api/types";

export function IncidentFilters({
  value,
  onSubmit,
}: {
  readonly value: IncidentListQuery;
  readonly onSubmit: (next: IncidentListQuery) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" ? raw.trim() : "";
    };
    onSubmit({
      status: read("status"),
      severity: read("severity"),
      exceptionCode: read("exceptionCode"),
      provider: read("provider"),
      from: read("from"),
      to: read("to"),
    });
  }

  return (
    <form className="filters" onSubmit={submit} aria-label="Incident filters">
      <label>
        Exception code
        <select name="exceptionCode" defaultValue={value.exceptionCode ?? ""}>
          <option value="">ALL</option>
          {EXCEPTION_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <label>
        Severity
        <select name="severity" defaultValue={value.severity ?? ""}>
          <option value="">ALL</option>
          {EXCEPTION_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={value.status ?? ""}>
          <option value="">ALL</option>
          {EXCEPTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Provider
        <input
          name="provider"
          defaultValue={value.provider ?? ""}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        From
        <input
          name="from"
          defaultValue={value.from ?? ""}
          autoComplete="off"
          spellCheck={false}
          placeholder="2026-01-15T10:00:01.000Z"
        />
      </label>
      <label>
        To
        <input
          name="to"
          defaultValue={value.to ?? ""}
          autoComplete="off"
          spellCheck={false}
          placeholder="2026-01-15T11:00:01.000Z"
        />
      </label>
      <button type="submit">Apply</button>
    </form>
  );
}
