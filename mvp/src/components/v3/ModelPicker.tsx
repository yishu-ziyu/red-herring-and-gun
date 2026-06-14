/**
 * ModelPicker.tsx — 4-Agent 模型选择器（简化版 BYO-API-key）
 *
 * 业务流程：
 * 1. 挂载时拉 GET /api/models/list（server 端按 env 过滤过的候选）
 * 2. 默认折叠（只露标题 + 一行摘要），点标题展开看到 4 个下拉
 * 3. 提供 4 个 preset：推荐组合 / 全部便宜 / 全部强 / 自定义（清空）
 * 4. 用户每次改动 → 调 onChange(modelChoice) 把当前选择冒泡给上层
 * 5. 如果 list 为空 → 渲染 "暂无可用模型" 提示，不让用户点启动
 *
 * 设计取舍：
 * - 选择状态完全受控（由父组件 lift 到 App.tsx），不在组件内 useState。
 * - 默认折叠避免首页一打开就 4 行下拉占满空间；展开动作由用户主动触发。
 * - 折叠态展示一个摘要：当前已配置的 agent 数量 / 用了哪个 preset。
 * - preset 的具体值写在本文件（推荐组合 / 全部便宜 / 全部强），这样测试和 UI 共享同一份事实。
 */

import { useEffect, useState, useCallback } from "react";

export type AgentId =
  | "rumor_detector"
  | "fact_checker"
  | "source_validator"
  | "report_composer";

export interface AvailableModel {
  provider: string;
  model: string;
  label: string;
  tier: "high" | "mid" | "low";
  hint: string;
}

export interface ModelChoiceEntry {
  provider: string;
  model: string;
}

export type ModelChoiceMap = Partial<Record<AgentId, ModelChoiceEntry>>;

interface ModelPickerProps {
  /** 当前选择（受控）。空对象表示用户还没选 / 选了"自定义"清空。 */
  value: ModelChoiceMap;
  /** 每次改动冒泡。父组件负责持久化（lift 到 App）。 */
  onChange: (next: ModelChoiceMap) => void;
  /** 用于 e2e / a11y。 */
}

const AGENT_IDS: AgentId[] = [
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
];

const AGENT_LABELS: Record<AgentId, string> = {
  rumor_detector: "Rumor Detector（先识别信息结构）",
  fact_checker: "Fact Checker（核查事实）",
  source_validator: "Source Validator（评估来源）",
  report_composer: "Report Composer（汇总报告）",
};

// ───────────────────────────────────────────────────────────────
// Preset 定义 — 4 种组合
// ───────────────────────────────────────────────────────────────

type PresetId = "recommended" | "all_cheap" | "all_strong" | "custom";

interface Preset {
  id: PresetId;
  label: string;
  /** 给定可用 models，返回 4 个 agent 的选择。返回 null 表示用"自定义"留空。 */
  apply: (models: AvailableModel[]) => ModelChoiceMap | null;
}

const PRESETS: Preset[] = [
  {
    id: "recommended",
    label: "推荐组合",
    // 推荐组合：高 reasoning 模型做 rumor_detector / fact_checker；中模型做 source_validator / report_composer
    apply: (models) => {
      const high = models.find((m) => m.tier === "high");
      const mid = models.find((m) => m.tier === "mid");
      if (!high || !mid) return null;
      return {
        rumor_detector: { provider: high.provider, model: high.model },
        fact_checker: { provider: high.provider, model: high.model },
        source_validator: { provider: mid.provider, model: mid.model },
        report_composer: { provider: mid.provider, model: mid.model },
      };
    },
  },
  {
    id: "all_cheap",
    label: "全部便宜",
    apply: (models) => {
      const low = models.find((m) => m.tier === "low");
      if (!low) return null;
      return {
        rumor_detector: { provider: low.provider, model: low.model },
        fact_checker: { provider: low.provider, model: low.model },
        source_validator: { provider: low.provider, model: low.model },
        report_composer: { provider: low.provider, model: low.model },
      };
    },
  },
  {
    id: "all_strong",
    label: "全部强",
    apply: (models) => {
      const high = models.find((m) => m.tier === "high");
      if (!high) return null;
      return {
        rumor_detector: { provider: high.provider, model: high.model },
        fact_checker: { provider: high.provider, model: high.model },
        source_validator: { provider: high.provider, model: high.model },
        report_composer: { provider: high.provider, model: high.model },
      };
    },
  },
  {
    id: "custom",
    label: "自定义",
    apply: () => null, // 自定义 = 清空，让用户自己选
  },
];

// ───────────────────────────────────────────────────────────────
// API 拉取
// ───────────────────────────────────────────────────────────────

interface ModelsListResponse {
  models: AvailableModel[];
}

async function fetchAvailableModels(): Promise<AvailableModel[]> {
  const res = await fetch("/api/models/list");
  if (!res.ok) {
    throw new Error(`models/list 返回 HTTP ${res.status}`);
  }
  const data = (await res.json()) as ModelsListResponse;
  return Array.isArray(data.models) ? data.models : [];
}

// ───────────────────────────────────────────────────────────────
// 组件
// ───────────────────────────────────────────────────────────────

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 默认折叠：减少首页视觉负担，用户主动点标题才展开
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "拉取模型列表失败");
        setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAgentChange = useCallback(
    (agentId: AgentId, entry: ModelChoiceEntry | null) => {
      const next: ModelChoiceMap = { ...value };
      if (entry) {
        next[agentId] = entry;
      } else {
        delete next[agentId];
      }
      onChange(next);
    },
    [value, onChange]
  );

  const handlePreset = useCallback(
    (preset: Preset) => {
      if (preset.id === "custom") {
        onChange({});
        return;
      }
      if (!models) return;
      const next = preset.apply(models);
      if (next) {
        onChange(next);
      }
    },
    [models, onChange]
  );

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  // 加载中
  if (models === null && !loadError) {
    return (
      <section
        aria-label="4-Agent 模型选择"
        className="model-picker"
        data-state="loading"
      >
        <p className="model-picker-loading">正在加载可用模型…</p>
      </section>
    );
  }

  // 此时 models 要么是空数组，要么是非空数组（null 已在上面 return）
  // 用 const 让 TypeScript 把它收窄成 AvailableModel[] 而不是 (AvailableModel[] | null)
  const loadedModels: AvailableModel[] = models ?? [];

  // 列表为空 / 加载失败 → 提示 + 阻止用户选择
  if (loadedModels.length === 0) {
    return (
      <section
        aria-label="4-Agent 模型选择"
        className="model-picker"
        data-state="empty"
      >
        <p className="model-picker-empty">
          {loadError
            ? `暂无可用模型：${loadError}`
            : "暂无可用模型。请在服务端配置至少一个 LLM 提供商的 API key 后刷新页面。"}
        </p>
      </section>
    );
  }

  // 折叠态摘要：告诉用户当前 4 个 Agent 的配置状态，避免展开才能知道有没有选
  const filledCount = AGENT_IDS.filter((id) => value[id]).length;
  const summaryLine: string = (() => {
    if (filledCount === 0) return "默认（不指定模型，走默认配置）";
    if (filledCount === AGENT_IDS.length) {
      const seenLabel = AGENT_IDS.map((id) => {
        const c = value[id];
        if (!c) return null;
        const m = loadedModels.find((x) => x.provider === c.provider && x.model === c.model);
        return m?.label ?? `${c.provider}/${c.model}`;
      });
      const allSame = seenLabel.every((l) => l && l === seenLabel[0]);
      if (allSame && seenLabel[0]) return `全部 Agent 使用 ${seenLabel[0]}`;
      return `4 个 Agent 均已指定模型`;
    }
    return `已为 ${filledCount}/${AGENT_IDS.length} 个 Agent 指定模型`;
  })();

  return (
    <section
      aria-label="4-Agent 模型选择"
      className="model-picker"
      data-state="ready"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="model-picker-header-toggle"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="model-picker-body"
      >
        <span className="model-picker-header-text">
          <span className="model-picker-title">4-Agent 模型选择</span>
          <span className="model-picker-hint">{summaryLine}</span>
        </span>
        <span className="model-picker-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div id="model-picker-body" className="model-picker-body">
          <div className="model-picker-presets" role="group" aria-label="预设组合">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="model-picker-preset-btn"
                onClick={() => handlePreset(preset)}
                data-preset={preset.id}
              >
                <span>{preset.label}</span>
                {preset.id === "recommended" ? (
                  <span className="model-picker-preset-badge" aria-label="推荐">
                    推荐
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <ul className="model-picker-agents">
            {AGENT_IDS.map((agentId) => {
              const current = value[agentId];
              const currentValue = current
                ? `${current.provider}:${current.model}`
                : "";
              const isFilled = Boolean(current);
              return (
                <li
                  key={agentId}
                  className="model-picker-agent-row"
                  data-agent-id={agentId}
                  data-filled={isFilled ? "true" : "false"}
                >
                  <label className="model-picker-agent-label" htmlFor={`model-picker-${agentId}`}>
                    {AGENT_LABELS[agentId]}
                  </label>
                  <select
                    id={`model-picker-${agentId}`}
                    className="model-picker-agent-select"
                    value={currentValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        handleAgentChange(agentId, null);
                        return;
                      }
                      const [provider, model] = v.split(":");
                      handleAgentChange(agentId, { provider, model });
                    }}
                  >
                    <option value="">（不指定，走默认）</option>
                    {loadedModels.map((m) => (
                      <option
                        key={`${m.provider}:${m.model}`}
                        value={`${m.provider}:${m.model}`}
                      >
                        {m.label} — {m.provider}/{m.model}
                        {m.hint ? `（${m.hint}）` : ""}
                      </option>
                    ))}
                  </select>
                  <span
                    className="model-picker-agent-status"
                    data-filled={isFilled ? "true" : "false"}
                    aria-live="polite"
                  >
                    {isFilled ? "已选" : "未选"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
