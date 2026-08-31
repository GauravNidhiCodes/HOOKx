export function App() {
  return (
    <div className="frame">
      <header className="masthead">
        <div className="masthead__identity">
          <p className="masthead__mark">HOOKX</p>
          <p className="masthead__name">Payment Webhook Reliability Engine</p>
        </div>
        <div className="masthead__meta">
          <p>OPERATOR SHELL</p>
          <p>FOUNDATION</p>
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        <span className="nav__item nav__item--current">OVERVIEW</span>
        <span className="nav__item">
          INGEST <span className="nav__flag">UNAVAILABLE</span>
        </span>
        <span className="nav__item">
          OPERATOR <span className="nav__flag">UNAVAILABLE</span>
        </span>
      </nav>

      <main className="main">
        <section className="split">
          <article className="panel">
            <h1 className="kicker">Problem</h1>
            <p className="lede">
              Payment providers send webhook events. Delivery is not a source of
              truth: events can be duplicated, delayed, reordered, malformed,
              retried, missing, or conflicting.
            </p>
            <p className="body">
              HOOKX receives those external events and converts them into a
              reliable, deterministic internal payment state. This shell
              establishes the operator surface. Ingest, persistence, and live
              payment data are not connected yet.
            </p>
          </article>

          <article className="panel">
            <h1 className="kicker">Domain contract</h1>
            <dl className="spec">
              <div className="spec__row">
                <dt>Transition</dt>
                <dd>event + current state → explicit result</dd>
              </div>
              <div className="spec__row">
                <dt>Identity</dt>
                <dd>provider + externalEventId</dd>
              </div>
              <div className="spec__row">
                <dt>Money</dt>
                <dd>bigint minor units + ISO currency</dd>
              </div>
              <div className="spec__row">
                <dt>Clock</dt>
                <dd>occurredAt / receivedAt are inputs</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="band">
          <h1 className="kicker">Lifecycle</h1>
          <ol className="lifecycle">
            <li>CREATED</li>
            <li>AUTHORIZED</li>
            <li>CAPTURED</li>
            <li>REFUNDED</li>
          </ol>
          <p className="annotation">
            FAILED is terminal from CREATED or AUTHORIZED. Invalid transitions
            are rejected. State is never mutated silently.
          </p>
        </section>

        <section className="split">
          <article className="panel">
            <h1 className="kicker">Signal language</h1>
            <ul className="signals">
              <li>
                <span className="signals__glyph" aria-hidden="true">
                  ✓
                </span>
                <span>ACCEPTED</span>
              </li>
              <li>
                <span className="signals__glyph" aria-hidden="true">
                  ×
                </span>
                <span>REJECTED</span>
              </li>
              <li>
                <span className="signals__glyph" aria-hidden="true">
                  ○
                </span>
                <span>IGNORED_DUPLICATE</span>
              </li>
              <li>
                <span className="signals__glyph" aria-hidden="true">
                  !
                </span>
                <span>CONFLICT</span>
              </li>
            </ul>
            <p className="annotation">
              Outcomes are typographic. Color is not a status channel.
            </p>
          </article>

          <article className="panel">
            <h1 className="kicker">Visual tokens</h1>
            <table className="tokens">
              <tbody>
                <tr>
                  <th scope="row">--black</th>
                  <td>#000000</td>
                </tr>
                <tr>
                  <th scope="row">--white</th>
                  <td>#FFFFFF</td>
                </tr>
              </tbody>
            </table>
            <p className="annotation">
              Surfaces, type, rules, and inverted actions only. No additional
              palette.
            </p>
          </article>
        </section>
      </main>

      <footer className="colophon">
        <p>HOOKX FOUNDATION</p>
        <p>NO LIVE PROVIDERS · NO PERSISTENCE · NO INGEST</p>
      </footer>
    </div>
  );
}
