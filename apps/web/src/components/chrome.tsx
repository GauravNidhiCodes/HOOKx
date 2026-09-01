import type { ReactNode } from "react";

export function SpecList({
  rows,
}: {
  readonly rows: readonly { readonly label: string; readonly value: ReactNode }[];
}) {
  return (
    <dl className="spec">
      {rows.map((row) => (
        <div className="spec__row" key={row.label}>
          <dt>{row.label}</dt>
          <dd className="mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="status-line" role="status">
      {children}
    </p>
  );
}

export function ErrorPanel({
  title,
  correlationId,
  code,
}: {
  readonly title: string;
  readonly correlationId?: string;
  readonly code?: string;
}) {
  return (
    <section className="empty" role="alert">
      <h1 className="kicker">{title}</h1>
      {code !== undefined && code.length > 0 ? <p className="mono">{code}</p> : null}
      {correlationId !== undefined && correlationId.length > 0 ? (
        <>
          <p>CORRELATION ID</p>
          <p className="mono">{correlationId}</p>
        </>
      ) : null}
    </section>
  );
}

export function SyntheticMark({
  show,
}: {
  readonly show: boolean;
}) {
  if (!show) {
    return null;
  }
  return (
    <p className="synthetic-flag" role="note">
      SYNTHETIC — simulator data. Does not represent a real customer
      transaction.
    </p>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="section">
      <h2 className="kicker">{title}</h2>
      {children}
    </section>
  );
}
