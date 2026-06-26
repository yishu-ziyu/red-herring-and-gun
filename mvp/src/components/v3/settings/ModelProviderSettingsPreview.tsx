import { useMemo, useState } from "react";

type ProviderStatus = "enabled" | "recommended" | "optional";

interface ProviderPreset {
  id: string;
  name: string;
  vendor: string;
  description: string;
  baseUrl: string;
  model: string;
  status: ProviderStatus;
}

const PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    vendor: "国产推理与结构化输出",
    description: "适合事实核查、原子命题拆解和结构化报告生成。默认走 V4 Pro，Flash 兜底高频请求。",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    status: "recommended",
  },
  {
    id: "minimax",
    name: "MiniMax",
    vendor: "中文生成与改写",
    description: "可作为报告改写和面向公众辟谣卡片生成模型。M3 旗舰 1M 上下文 + 原生多模态。",
    baseUrl: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M3",
    status: "recommended",
  },
  {
    id: "360gpt",
    name: "360GPT",
    vendor: "360 生态联动",
    description: "用于体现 360GPT 与 360 AI Search 的协同核查能力。",
    baseUrl: "https://api.360.cn/v1",
    model: "360gpt-pro",
    status: "recommended",
  },
  {
    id: "stepfun",
    name: "StepFun",
    vendor: "长上下文 Agent 调度",
    description: "适合中控调度、长上下文审计和多 Agent 交接摘要。默认 Step-3.7 Flash。",
    baseUrl: "https://api.stepfun.com/v1",
    model: "step-3.7-flash",
    status: "enabled",
  },
  {
    id: "kimi",
    name: "Kimi",
    vendor: "长文档和网页材料理解",
    description: "适合长材料摘要、引用整理和候选证据初筛。Kimi K2 系列，项目暂无 key。",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-latest",
    status: "optional",
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible",
    vendor: "兼容接口",
    description: "为已有 OpenAI 兼容代理预留。默认不启用。",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    status: "optional",
  },
];

const statusLabel: Record<ProviderStatus, string> = {
  enabled: "已启用",
  recommended: "推荐",
  optional: "可选",
};

export function ModelProviderSettingsPreview() {
  const [selectedId, setSelectedId] = useState("deepseek");
  const selectedProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.id === selectedId) ?? PROVIDERS[0],
    [selectedId]
  );

  return (
    <main className="model-settings-preview">
      <aside className="model-settings-sidebar" aria-label="服务商列表">
        <div className="model-settings-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="搜索服务商…" aria-label="搜索服务商" />
        </div>
        <div className="model-provider-group">
          <span>接入状态</span>
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              aria-label={provider.name}
              aria-pressed={selectedId === provider.id}
              onClick={() => setSelectedId(provider.id)}
            >
              <strong>{provider.name}</strong>
              <small>{statusLabel[provider.status]}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="model-settings-main" aria-label="模型服务商配置">
        <header className="model-settings-header">
          <div>
            <span>Model Settings</span>
            <h1>模型服务商</h1>
          </div>
          <a href="/" className="model-settings-back">
            返回首页
          </a>
        </header>

        <section className="provider-detail-card">
          <div className="provider-detail-head">
            <div>
              <span>{selectedProvider.vendor}</span>
              <h2>{selectedProvider.name}</h2>
            </div>
            <label className="provider-switch">
              <input type="checkbox" defaultChecked />
              <span>启用</span>
            </label>
          </div>
          <p>{selectedProvider.description}</p>

          <div className="provider-form-grid">
            <label>
              <span>API Key</span>
              <input
                aria-label="API Key"
                type="password"
                placeholder={`${selectedProvider.name} API Key`}
                autoComplete="off"
              />
            </label>
            <label>
              <span>API 代理地址</span>
              <input aria-label="API 代理地址" value={selectedProvider.baseUrl} readOnly />
            </label>
            <label>
              <span>默认模型</span>
              <input aria-label="默认模型" value={selectedProvider.model} readOnly />
            </label>
          </div>

          <div className="provider-check-row">
            <button type="button">检查连通性</button>
            <small>预览页不会保存密钥；正式接入时再接本地加密存储。</small>
          </div>
        </section>

        <section className="provider-model-list" aria-label="模型列表">
          <header>
            <h2>模型列表</h2>
            <span>已预置默认模型，用户无需手动填写。</span>
          </header>
          <article>
            <strong>{selectedProvider.model}</strong>
            <span>对话 · 证据审计 · Agent 调度</span>
            <em>启用</em>
          </article>
        </section>
      </section>
    </main>
  );
}
