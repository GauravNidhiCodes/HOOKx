export function SanitizedPayload() {
  return (
    <details className="payload">
      <summary>SANITIZED PAYLOAD</summary>
      <p>
        Raw webhook payloads are not stored. HOOKX keeps a normalized event
        identity, timestamps, amount in minor units, and processing status.
        Secrets, API keys, signatures, and credentials are not available here.
      </p>
    </details>
  );
}
