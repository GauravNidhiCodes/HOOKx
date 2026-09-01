import { Link } from "../routing/router";

export function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="frame">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="masthead">
        <div className="masthead__identity">
          <p className="masthead__mark">HOOKX</p>
          <p className="masthead__name">Payment Webhook Reliability</p>
        </div>
        <div className="masthead__meta">
          <p>OPERATOR CONSOLE</p>
          <p>DETERMINISTIC PROCESSING</p>
        </div>
      </header>
      <nav className="nav" aria-label="Primary">
        <Link href="/exceptions" className="nav__item">
          Exceptions
        </Link>
        <Link href="/incidents" className="nav__item">
          Incidents
        </Link>
        <Link href="/payments" className="nav__item">
          Payments
        </Link>
        <Link href="/events" className="nav__item">
          Events
        </Link>
        <Link href="/failure-lab" className="nav__item">
          Failure Lab
        </Link>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="colophon">
        <p>DETERMINISTIC PROCESSING · AI INVESTIGATION IS ADVISORY</p>
        <p>SYNTHETIC EVENTS ARE LABELLED</p>
      </footer>
    </div>
  );
}
