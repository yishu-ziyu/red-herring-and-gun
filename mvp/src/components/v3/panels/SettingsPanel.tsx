import { useState } from "react";

export function SettingsPanel() {
  const [theme, setTheme] = useState("light");
  const [model, setModel] = useState("minimax");

  return (
    <section className="workspace-panel" aria-label="Settings panel">
      <div className="panel-heading">
        <span>设置</span>
        <strong>系统配置</strong>
      </div>
      <div className="panel-content">
        <div className="info-block">
          <h3>外观主题</h3>
          <div className="mode-grid">
            <button
              className={`mode-button ${theme === "light" ? "selected" : ""}`}
              onClick={() => setTheme("light")}
              type="button"
            >
              浅色
            </button>
            <button
              className={`mode-button ${theme === "dark" ? "selected" : ""}`}
              onClick={() => setTheme("dark")}
              type="button"
            >
              深色
            </button>
          </div>
        </div>

        <div className="info-block">
          <h3>模型配置</h3>
          <div className="settings-model-card">
            <div className="settings-model-header">
              <span className="settings-model-badge">当前使用</span>
              <strong className="settings-model-name">MiniMax-M2.7</strong>
            </div>
            <p className="settings-model-desc">
              通过 Anthropic proxy 接入的国产大模型，支持长上下文和结构化输出。
            </p>
            <div className="mode-grid" style={{ marginTop: "12px" }}>
              <button
                className={`mode-button ${model === "minimax" ? "selected" : ""}`}
                onClick={() => setModel("minimax")}
                type="button"
              >
                MiniMax-M2.7
              </button>
              <button
                className={`mode-button ${model === "gpt-4" ? "selected" : ""}`}
                onClick={() => setModel("gpt-4")}
                type="button"
              >
                GPT-4
              </button>
              <button
                className={`mode-button ${model === "claude" ? "selected" : ""}`}
                onClick={() => setModel("claude")}
                type="button"
              >
                Claude
              </button>
            </div>
          </div>
        </div>

        <div className="info-block">
          <h3>360 生态（即将接入）</h3>
          <div className="settings-eco-list">
            <div className="settings-eco-item">
              <div className="settings-eco-info">
                <span className="settings-eco-name">360 搜索增强</span>
                <span className="settings-eco-desc">接入 360 搜索引擎，提升信息检索覆盖度</span>
              </div>
              <span className="settings-eco-badge">即将接入</span>
            </div>
            <div className="settings-eco-item">
              <div className="settings-eco-info">
                <span className="settings-eco-name">360 安全大脑</span>
                <span className="settings-eco-desc">利用 360 安全能力识别恶意信息和钓鱼链接</span>
              </div>
              <span className="settings-eco-badge">即将接入</span>
            </div>
            <div className="settings-eco-item">
              <div className="settings-eco-info">
                <span className="settings-eco-name">360 百科知识图谱</span>
                <span className="settings-eco-desc">基于 360 百科构建实体关系图谱辅助核查</span>
              </div>
              <span className="settings-eco-badge">即将接入</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
