/**
 * Dev preview: fixture → MissionProcessShell (no live SSE).
 * Routes: /shell-preview or ?shellPreview=1
 */
import { useMemo, useState } from "react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_AGENT_ERROR,
  FIXTURE_COMPLETE,
  FIXTURE_DEBATE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
} from "../../../../lib/missionShell";
import { MissionProcessShell, type MissionProcessShellVariant } from "./MissionProcessShell";

type FixtureKey =
  | "early"
  | "mid"
  | "complete"
  | "error"
  | "agent_error"
  | "review_fail"
  | "debate";

const MAP = {
  early: FIXTURE_EARLY,
  mid: FIXTURE_MID,
  complete: FIXTURE_COMPLETE,
  error: FIXTURE_ERROR,
  agent_error: FIXTURE_AGENT_ERROR,
  review_fail: FIXTURE_REVIEW_FAIL,
  debate: FIXTURE_DEBATE,
} as const;

const FIXTURE_LABEL: Record<FixtureKey, string> = {
  early: "开跑",
  mid: "中段",
  complete: "完成",
  error: "失败",
  agent_error: "角色失败",
  review_fail: "审稿未过",
  debate: "调解",
};

const FIXTURE_KEYS = new Set<string>(Object.keys(MAP));

function parsePreviewQuery(): { fixture: FixtureKey; variant: MissionProcessShellVariant } {
  if (typeof window === "undefined") {
    return { fixture: "mid", variant: "token" };
  }
  const params = new URLSearchParams(window.location.search);
  const rawFixture = params.get("fixture");
  const rawVariant = params.get("variant");
  const fixture: FixtureKey =
    rawFixture && FIXTURE_KEYS.has(rawFixture) ? (rawFixture as FixtureKey) : "mid";
  const variant: MissionProcessShellVariant =
    rawVariant === "antdx" || rawVariant === "token" ? rawVariant : "token";
  return { fixture, variant };
}

/** Keep shareable deep-link in address bar without full navigation. */
function writePreviewQuery(fixture: FixtureKey, variant: MissionProcessShellVariant) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("fixture", fixture);
  params.set("variant", variant);
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}

export function MissionShellPreview() {
  const initial = parsePreviewQuery();
  const [key, setKey] = useState<FixtureKey>(initial.fixture);
  const [variant, setVariant] = useState<MissionProcessShellVariant>(initial.variant);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const model = useMemo(() => adaptOrchestrateStreamToShell(MAP[key]), [key]);

  const selectFixture = (k: FixtureKey) => {
    setKey(k);
    setSelectedAgentId(null);
    writePreviewQuery(k, variant);
  };
  const selectVariant = (v: MissionProcessShellVariant) => {
    setVariant(v);
    writePreviewQuery(key, v);
  };

  return (
    <div className="mps-preview-page">
      <div className="mps-preview-bar">
        <strong>Mission Shell 预览</strong>
        {(
          ["early", "mid", "debate", "complete", "review_fail", "error", "agent_error"] as FixtureKey[]
        ).map((k) => (
          <button
            key={k}
            type="button"
            className={key === k ? "mps-preview-tab mps-preview-tab--on" : "mps-preview-tab"}
            onClick={() => selectFixture(k)}
          >
            {FIXTURE_LABEL[k]}
          </button>
        ))}
        <button
          type="button"
          className={variant === "token" ? "mps-preview-tab mps-preview-tab--on" : "mps-preview-tab"}
          onClick={() => selectVariant("token")}
        >
          token 自绘
        </button>
        <button
          type="button"
          className={variant === "antdx" ? "mps-preview-tab mps-preview-tab--on" : "mps-preview-tab"}
          onClick={() => selectVariant("antdx")}
        >
          Ant Design X
        </button>
      </div>
      <p className="mps-preview-caption">
        本地 fixture，非 live SSE。
        <a href="/?shell=1">真跑请用 /?shell=1 开案</a>
      </p>
      <MissionProcessShell
        model={model}
        variant={variant}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
      />
      {selectedAgentId ? (
        <p className="mps-preview-select">选中角色：{selectedAgentId}</p>
      ) : null}
    </div>
  );
}
