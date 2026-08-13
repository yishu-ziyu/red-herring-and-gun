/**
 * ModelPicker.tsx — composer-inline model choice (BYO-API-key)
 *
 * Lives in the PromptInput action row, left of send.
 * Collapsed: a short name + chevron. Expanded: a popover with presets and 4 selects.
 */

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";

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
  rumor_detector: "识别信息结构",
  fact_checker: "核查事实",
  source_validator: "评估来源",
  report_composer: "汇总报告",
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

function sameChoiceMap(a: ModelChoiceMap, b: ModelChoiceMap): boolean {
  return AGENT_IDS.every((id) => {
    const left = a[id];
    const right = b[id];
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.provider === right.provider && left.model === right.model;
  });
}

function shortTriggerLabel(
  value: ModelChoiceMap,
  loadedModels: AvailableModel[]
): string {
  const filledCount = AGENT_IDS.filter((id) => value[id]).length;
  if (filledCount === 0) return "默认";
  for (const preset of PRESETS) {
    if (preset.id === "custom") continue;
    const applied = preset.apply(loadedModels);
    if (applied && sameChoiceMap(applied, value)) return preset.label;
  }
  const labels = AGENT_IDS.map((id) => {
    const choice = value[id];
    if (!choice) return null;
    const match = loadedModels.find(
      (item) => item.provider === choice.provider && item.model === choice.model
    );
    return match?.label ?? `${choice.provider}/${choice.model}`;
  });
  if (filledCount === AGENT_IDS.length) {
    const first = labels[0];
    const allSame = Boolean(first) && labels.every((label) => label === first);
    if (allSame && first) return first;
    return "已指定";
  }
  return `${filledCount}/4`;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: Event) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const root = rootRef.current;
    const body = root?.querySelector<HTMLElement>("#model-picker-body");
    if (!root || !body) return;

    const place = () => {
      const trigger = root.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      let left = rect.right - width;
      left = Math.max(12, Math.min(left, window.innerWidth - 12 - width));
      const below = rect.bottom + 6;
      const height = body.offsetHeight;
      const flipUp =
        below + height > window.innerHeight - 12 && rect.top - 6 - height > 12;
      body.style.position = "fixed";
      body.style.left = `${left}px`;
      body.style.right = "auto";
      body.style.width = `${width}px`;
      body.style.top = flipUp ? `${rect.top - 6 - height}px` : `${below}px`;
      body.style.bottom = "auto";
    };

    place();
    const raf = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [expanded]);

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

  if (models === null && !loadError) {
    return (
      <section
        ref={rootRef}
        aria-label="模型选择"
        className="model-picker"
        data-state="loading"
      >
        <span className="model-picker-inline-status">加载中</span>
      </section>
    );
  }

  const loadedModels: AvailableModel[] = models ?? [];

  if (loadedModels.length === 0) {
    return (
      <section
        ref={rootRef}
        aria-label="模型选择"
        className="model-picker"
        data-state="empty"
      >
        <span className="model-picker-empty">
          {loadError ? `暂无可用模型：${loadError}` : "暂无可用模型"}
        </span>
      </section>
    );
  }

  const triggerLabel = shortTriggerLabel(value, loadedModels);

  return (
    <section
      ref={rootRef}
      aria-label="模型选择"
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
        aria-haspopup="dialog"
        title={triggerLabel}
      >
        <span className="model-picker-sr">模型选择</span>
        <span className="model-picker-hint">{triggerLabel}</span>
        <span className="model-picker-chevron" aria-hidden="true">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded ? (
        <div
          id="model-picker-body"
          className="model-picker-body"
          role="dialog"
          aria-label="为各步骤指定模型"
        >
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
