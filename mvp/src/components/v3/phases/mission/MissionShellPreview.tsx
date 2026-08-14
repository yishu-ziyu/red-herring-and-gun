/**
 * Dev preview: fixture → MissionProcessShell (no live SSE).
 * Routes: /shell-preview or ?shellPreview=1
 *
 * antdx tab is frozen — token narrative only.
 */
import { useMemo, useState } from "react";
import {
  adaptOrchestrateStreamToShell,
  buildVisibleProcessRows,
  FIXTURE_AGENT_ERROR,
  FIXTURE_AGENT_THOUGHT,
  FIXTURE_COMPLETE,
  FIXTURE_DEBATE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
  FIXTURE_TRIAGE_RUNNING,
} from "../../../../lib/missionShell";
import { MissionProcessShell } from "./MissionProcessShell";
import { MissionWorkSurface } from "./MissionWorkSurface";

type FixtureKey =
  | "early"
  | "mid"
  | "complete"
  | "error"
  | "agent_error"
  | "agent_thought"
  | "review_fail"
  | "triage"
  | "debate";

const MAP = {
  early: FIXTURE_EARLY,
  triage: FIXTURE_TRIAGE_RUNNING,
  mid: FIXTURE_MID,
  complete: FIXTURE_COMPLETE,
  error: FIXTURE_ERROR,
  agent_error: FIXTURE_AGENT_ERROR,
  agent_thought: FIXTURE_AGENT_THOUGHT,
  review_fail: FIXTURE_REVIEW_FAIL,
  debate: FIXTURE_DEBATE,
} as const;

const FIXTURE_LABEL: Record<FixtureKey, string> = {
  early: "开跑",
  triage: "拆题中",
  mid: "中段",
  complete: "完成",
  error: "失败",
  agent_error: "角色失败",
  agent_thought: "吐字中",
  review_fail: "审稿未过",
  debate: "调解",
};

const FIXTURE_KEYS = new Set<string>(Object.keys(MAP));

function parsePreviewQuery(): FixtureKey {
  if (typeof window === "undefined") return "mid";
  const params = new URLSearchParams(window.location.search);
  const rawFixture = params.get("fixture");
  return rawFixture && FIXTURE_KEYS.has(rawFixture) ? (rawFixture as FixtureKey) : "mid";
}

/** Keep shareable deep-link in address bar without full navigation. */
function writePreviewQuery(fixture: FixtureKey) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("fixture", fixture);
  params.delete("variant"); // antdx frozen
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}

export function MissionShellPreview() {
  const [key, setKey] = useState<FixtureKey>(parsePreviewQuery);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const model = useMemo(() => adaptOrchestrateStreamToShell(MAP[key]), [key]);
  const narrative = useMemo(() => buildVisibleProcessRows(model), [model]);
  const selectedTitle =
    narrative.rows.find((r) => r.key === selectedRowKey)?.title ??
    narrative.rows.find((r) => r.isCurrent)?.title ??
    null;

  const selectFixture = (k: FixtureKey) => {
    setKey(k);
    setSelectedAgentId(null);
    setSelectedRowKey(null);
    writePreviewQuery(k);
  };

  return (
    <div className="mps-preview-page">
      <div className="mps-preview-bar">
        <strong>Mission Shell 预览</strong>
        {(
          [
            "early",
            "triage",
            "mid",
            "agent_thought",
            "debate",
            "complete",
            "review_fail",
            "error",
            "agent_error",
          ] as FixtureKey[]
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
        <button type="button" className="mps-preview-tab mps-preview-tab--on" disabled>
          token 自绘
        </button>
        <button
          type="button"
          className="mps-preview-tab mps-preview-tab--frozen"
          disabled
          title="Ant Design X 路径已冻结，产品仅使用 token 叙事壳"
        >
          Ant Design X · 已冻结
        </button>
      </div>
      <p className="mps-preview-caption">
        左栏：先说话，再放工具/思考卡。右栏是正在核对的东西。本地 fixture，不是真跑。
        <a href="/?shell=1">真跑请用 /?shell=1 开案</a>
      </p>
      <div className="mps-preview-desk">
        <MissionProcessShell
          model={model}
          variant="token"
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
          deskMode
          selectedRowKey={selectedRowKey ?? narrative.rows.find((r) => r.isCurrent)?.key ?? null}
          onSelectRow={setSelectedRowKey}
        />
        <MissionWorkSurface model={model} selectedTitle={selectedTitle} />
      </div>
      {selectedAgentId ? (
        <p className="mps-preview-select">选中角色：{selectedAgentId}</p>
      ) : null}
    </div>
  );
}
