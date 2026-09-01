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
          <p>AI OUTSIDE THE FINANCIAL PATH</p>
        </div>
      </header>
      <nav className="nav" aria-label="Primary">
        <Link href="/" className="nav__item">
          Overview
        </Link>
        <Link href="/failure-lab" className="nav__item">
          Failure Lab
        </Link>
        <Link href="/incidents" className="nav__item">
          Incidents
        </Link>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="colophon">
        <p>DETERMINISTIC PROCESSING · AI INVESTIGATION IS READ-ONLY</p>
        <p>SYNTHETIC EVENTS ARE LABELLED · NO FINANCIAL STATE CHANGES FROM AI</p>
      </footer>
    </div>
  );
}
