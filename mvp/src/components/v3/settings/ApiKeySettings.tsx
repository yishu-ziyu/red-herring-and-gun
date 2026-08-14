import { useEffect, useMemo, useState } from "react";
import {
  BYO_PROVIDER_PRESETS,
  CUSTOM_PRESET_ID,
  matchByoPreset,
  type ByoProviderPreset,
} from "../../../lib/byoProviderPresets";
import { ProviderMark } from "./ProviderMark";

const STORAGE_KEY = "gun-byo-key";
const TIMESTAMP_KEY = "gun-byo-key-last-tested-at";
const DEFAULT_PRESET = BYO_PROVIDER_PRESETS[0];

interface StoredKey {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  error?: string;
  testedAt: number;
}

function obfuscate(value: StoredKey): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function deobfuscate(raw: string): StoredKey | null {
  try {
    const decoded = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.baseUrl === "string" &&
      typeof parsed.apiKey === "string" &&
      typeof parsed.modelName === "string"
    ) {
      return parsed as StoredKey;
    }
    return null;
  } catch {
    return null;
  }
}

function isSafeBaseUrl(baseUrl: string): boolean {
  if (baseUrl.startsWith("https://")) return true;
  if (baseUrl.startsWith("http://localhost")) return true;
  if (baseUrl.startsWith("http://127.0.0.1")) return true;
  return false;
}

function formatTestedAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function modelsForPreset(preset: ByoProviderPreset, modelName: string) {
  if (!modelName.trim() || preset.models.some((model) => model.id === modelName)) {
    return preset.models;
  }
  return [...preset.models, { id: modelName, label: modelName }];
}

export function ApiKeySettings() {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PRESET.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState(DEFAULT_PRESET.defaultModel);
  const [hydrated, setHydrated] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveHint, setSaveHint] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = deobfuscate(raw);
      if (parsed) {
        const matched = matchByoPreset(parsed.baseUrl);
        setPresetId(matched?.id ?? CUSTOM_PRESET_ID);
        setBaseUrl(parsed.baseUrl);
        setApiKey(parsed.apiKey);
        setModelName(parsed.modelName);
      }
    }
    const lastTs = window.localStorage.getItem(TIMESTAMP_KEY);
    if (lastTs && !Number.isNaN(Number(lastTs))) {
      setTestResult({
        ok: true,
        testedAt: Number(lastTs),
      });
    }
    setHydrated(true);
  }, []);

  const selectedPreset = useMemo(
    () => BYO_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? null,
    [presetId]
  );
  const isCustom = presetId === CUSTOM_PRESET_ID;
  const modelOptions = selectedPreset ? modelsForPreset(selectedPreset, modelName) : [];

  const baseUrlError = useMemo(() => {
    if (!hydrated) return "";
    if (!baseUrl.trim()) return "";
    if (!isSafeBaseUrl(baseUrl.trim())) {
      return "Base URL 必须以 https:// 开头（dev 允许 http://localhost）。";
    }
    return "";
  }, [baseUrl, hydrated]);

  const canSubmit = Boolean(baseUrl.trim() && apiKey.trim() && !baseUrlError);

  const selectPreset = (nextId: string) => {
    if (nextId === CUSTOM_PRESET_ID) {
      setPresetId(CUSTOM_PRESET_ID);
      return;
    }
    const next = BYO_PROVIDER_PRESETS.find((preset) => preset.id === nextId);
    if (!next) return;
    setPresetId(next.id);
    setBaseUrl(next.baseUrl);
    if (!next.models.some((model) => model.id === modelName)) {
      setModelName(next.defaultModel);
    }
  };

  const handleSave = () => {
    if (!canSubmit) return;
    const payload: StoredKey = {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
    };
    window.localStorage.setItem(STORAGE_KEY, obfuscate(payload));
    setSaveHint("已保存到本地浏览器存储。");
    window.setTimeout(() => setSaveHint(""), 2500);
  };

  const handleTest = async () => {
    setSaveHint("");
    if (!canSubmit) {
      setTestResult({
        ok: false,
        error: baseUrlError || "请填写 Base URL 和 API Key。",
        testedAt: Date.now(),
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/agent/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        latencyMs?: number;
        status?: number;
        error?: string;
      };
      const result: TestResult = {
        ok: Boolean(data.ok),
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
        testedAt: Date.now(),
      };
      setTestResult(result);
      if (result.ok) {
        window.localStorage.setItem(TIMESTAMP_KEY, String(result.testedAt));
      }
    } catch (error) {
      setTestResult({
        ok: false,
        error: error instanceof Error ? error.message : "未知网络错误",
        testedAt: Date.now(),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="api-key-settings" aria-label="模型设置">
      <div className="api-key-settings-inner">
        <header className="api-key-settings-header">
          <div>
            <h1>模型设置</h1>
          </div>
          <a href="/" className="api-key-settings-back">
            返回首页
          </a>
        </header>

        <p className="api-key-settings-intro">
          点一家，只填密钥。密钥保存在本机浏览器存储中。
        </p>

        <div className="api-key-chip-row" role="group" aria-label="服务商">
          {BYO_PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="api-key-chip"
              aria-pressed={presetId === preset.id}
              onClick={() => selectPreset(preset.id)}
            >
              <ProviderMark id={preset.id} />
              {preset.name}
            </button>
          ))}
          <button
            type="button"
            className="api-key-chip"
            aria-pressed={isCustom}
            onClick={() => selectPreset(CUSTOM_PRESET_ID)}
          >
            <ProviderMark id="custom" />
            自定义
          </button>
        </div>

        <div className="api-key-form-grid">
          <label className="api-key-field">
            <span>接口地址</span>
            <input
              aria-label="Base URL"
              type="text"
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>

          <label className="api-key-field">
            <span>API Key</span>
            <input
              aria-label="API Key"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>

          {isCustom ? (
            <label className="api-key-field">
              <span>模型名</span>
              <input
                aria-label="Model Name"
                type="text"
                placeholder="可留空"
                autoComplete="off"
                spellCheck={false}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </label>
          ) : (
            <div className="api-key-field">
              <span>模型</span>
              <div className="api-key-chip-row" role="group" aria-label="模型">
                {modelOptions.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className="api-key-chip"
                    aria-pressed={modelName === model.id}
                    onClick={() => setModelName(model.id)}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {baseUrlError ? (
          <p className="api-key-settings-error" role="alert">
            {baseUrlError}
          </p>
        ) : null}

        <div className="api-key-actions">
          <button type="button" onClick={handleTest} disabled={!canSubmit || testing} aria-busy={testing}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button type="button" onClick={handleSave} disabled={!canSubmit}>
            保存
          </button>
        </div>

        {saveHint ? <p className="api-key-settings-hint">{saveHint}</p> : null}

        {testResult ? (
          <div
            className={`api-key-test-result ${testResult.ok ? "ok" : "fail"}`}
            role={testResult.ok ? "status" : "alert"}
            aria-live="polite"
          >
            <strong>
              {testResult.ok ? "连接成功" : "连接失败"}
              {typeof testResult.latencyMs === "number" ? ` · ${testResult.latencyMs}ms` : ""}
              {typeof testResult.status === "number" ? ` · HTTP ${testResult.status}` : ""}
            </strong>
            {testResult.error ? <span>{testResult.error}</span> : null}
            <small>上次测试：{formatTestedAt(testResult.testedAt)}</small>
          </div>
        ) : null}

        <p className="api-key-settings-footnote">
          base64 不是加密，只是避免明文直接写入 localStorage。共享电脑或公共浏览器使用后，请清除这份配置。测试连接时，本页会把密钥发送到当前站点的测试接口，由服务端代你向所填地址发起一次连接测试。页面不会在测试结果里回显密钥。
        </p>
      </div>
    </main>
  );
}

export default ApiKeySettings;
