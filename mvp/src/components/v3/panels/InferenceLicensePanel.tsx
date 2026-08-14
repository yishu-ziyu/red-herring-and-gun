import type { InferenceLicense } from "../../../lib/schemas";

interface InferenceLicensePanelProps {
  license: InferenceLicense | undefined;
}

function confidenceLabel(c: InferenceLicense["confidence"]): string {
  switch (c) {
    case "high":
      return "把握：高";
    case "medium":
      return "把握：中";
    case "low":
      return "把握：低";
  }
}

export function InferenceLicensePanel({ license }: InferenceLicensePanelProps) {
  if (!license) return null;

  return (
    <section
      className="inference-license-panel editorial cinema-rise"
      aria-label="能信的范围"
    >
      <header className="inference-license-header">
        <h4 className="inference-license-title">能信的范围</h4>
        <span className="inference-license-confidence small-caps">
          {confidenceLabel(license.confidence)} · 覆盖 {license.coverage.withAllowed}/{license.coverage.totalSubclaims}
        </span>
      </header>

      <div className="inference-license-cols">
        <div className="inference-license-col inference-license-allowed">
          <h5 className="inference-license-col-title">
            <span className="boundary-col-dot boundary-col-dot--allowed" />
            能信 ({license.allowed.length})
          </h5>
          {license.allowed.length === 0 ? (
            <p className="inference-license-empty">当前材料无明显支持点。</p>
          ) : (
            <ul className="boundary-list">
              {license.allowed.map((item, i) => (
                <li key={i} className="boundary-list-item">{item.text}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="inference-license-col inference-license-blocked">
          <h5 className="inference-license-col-title">
            <span className="boundary-col-dot boundary-col-dot--blocked" />
            不能信 ({license.blocked.length})
          </h5>
          {license.blocked.length === 0 ? (
            <p className="inference-license-empty">当前材料无明显禁止项。</p>
          ) : (
            <ul className="boundary-list">
              {license.blocked.map((item, i) => (
                <li key={i} className="boundary-list-item">{item.text}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}