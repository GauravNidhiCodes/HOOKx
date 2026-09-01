import type { PublicInvestigation } from "../api/types";

export function InvestigationPanel({
  investigation,
}: {
  readonly investigation: PublicInvestigation;
}) {
  const advisory = investigation.investigator === "unavailable";
  return (
    <div className="investigation">
      <p className="advisory">
        ADVISORY — SYSTEM OF RECORD REMAINS DETERMINISTIC
      </p>
      {advisory ? (
        <p className="advisory">INVESTIGATION UNAVAILABLE — NO PAYMENT STATE CHANGED</p>
      ) : (
        <p className="advisory">AI INVESTIGATION — DOES NOT MUTATE PAYMENT STATE</p>
      )}
      <h3 className="kicker">SUMMARY</h3>
      <p>{investigation.result.summary}</p>
      <h3 className="kicker">EVIDENCE</h3>
      <ul className="evidence">
        {investigation.result.evidence.map((item) => (
          <li key={`${item.sourceType}-${item.sourceId}-${item.fact}`}>
            <span className="mono">
              {item.sourceType} {item.sourceId}
            </span>
            <p>{item.fact}</p>
          </li>
        ))}
      </ul>
      <h3 className="kicker">LIKELY CAUSE</h3>
      <p>{investigation.result.likelyCause}</p>
      <h3 className="kicker">RECOMMENDED ACTION</h3>
      <p className="mono">{investigation.result.recommendedAction.code}</p>
      <p>{investigation.result.recommendedAction.detail}</p>
      <p className="advisory">NOT EXECUTABLE</p>
      <h3 className="kicker">CONFIDENCE</h3>
      <p className="mono">{investigation.result.confidence}</p>
      <p>Confidence in the explanation, not that money is safe.</p>
      <h3 className="kicker">LIMITATIONS</h3>
      <ul>
        {investigation.result.limitations.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
