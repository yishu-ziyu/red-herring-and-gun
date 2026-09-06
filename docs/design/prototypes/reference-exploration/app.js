/**
 * 红鲱鱼与枪 · Design Exploration Playground 交互逻辑
 * 严格支持：
 * 1. 键盘 1 / 2 / 3 无缝切换 Mode 1, Mode 2, Mode 3
 * 2. 真实 Evidence Settling (FLIP 保持 DOM 身份连续性)
 * 3. Mode 3 三大 Signature Interaction: Claim Trace, Settling, Conclusion Emergence
 * 4. Source Drawer / Bottom Sheet 可访问性焦点恢复与 Escape 关闭
 */

import { INVESTIGATION_CASE } from "./data.js";

// 全局响应式状态
const state = {
  mode: 3, // 1: Editorial, 2: Interactive, 3: Hybrid (默认推荐)
  phase: "complete", // "investigating" | "complete"
  activeDrawerSourceId: null,
  activeTraceClaimId: null,
  isMobileSimulated: false,
  lastFocusedElement: null
};

// DOM 引用缓存
const dom = {
  appRoot: document.getElementById("app-root"),
  canvasWrapper: document.getElementById("canvas-wrapper"),
  docContainer: document.getElementById("doc-container"),
  switcherBtns: document.querySelectorAll("[data-mode-btn]"),
  replayBtn: document.getElementById("btn-replay-settling"),
  phaseBtn: document.getElementById("btn-toggle-phase"),
  viewportBtn: document.getElementById("btn-toggle-viewport"),
  drawerScrim: document.getElementById("drawer-scrim"),
  sourceDrawer: document.getElementById("source-drawer"),
  drawerCloseBtn: document.getElementById("drawer-close-btn"),
  drawerBody: document.getElementById("drawer-body")
};

// 初始化应用
function init() {
  bindEvents();
  render();
}

// 绑定全局事件
function bindEvents() {
  // 键盘快捷键 1 / 2 / 3 切换模式
  window.addEventListener("keydown", (e) => {
    // 忽略在输入框或文本域中的按键
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    
    if (e.key === "1") switchMode(1);
    if (e.key === "2") switchMode(2);
    if (e.key === "3") switchMode(3);

    if (e.key === "Escape") {
      if (state.activeDrawerSourceId) {
        closeDrawer();
      }
    }
  });

  // 顶部切换器按钮事件
  dom.switcherBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = parseInt(btn.getAttribute("data-mode-btn"), 10);
      switchMode(mode);
    });
  });

  if (dom.replayBtn) {
    dom.replayBtn.addEventListener("click", () => triggerSettlingAnimation());
  }

  if (dom.phaseBtn) {
    dom.phaseBtn.addEventListener("click", () => {
      state.phase = state.phase === "complete" ? "investigating" : "complete";
      dom.phaseBtn.textContent = state.phase === "complete" ? "当前：完成态" : "当前：调查中";
      render();
    });
  }

  if (dom.viewportBtn) {
    dom.viewportBtn.addEventListener("click", () => {
      state.isMobileSimulated = !state.isMobileSimulated;
      dom.viewportBtn.textContent = state.isMobileSimulated ? "视口：390px (Mobile)" : "视口：1440px (Desktop)";
      if (state.isMobileSimulated) {
        dom.canvasWrapper.style.maxWidth = "390px";
      } else {
        dom.canvasWrapper.style.maxWidth = "780px";
      }
    });
  }

  // Drawer 关闭事件
  dom.drawerScrim.addEventListener("click", closeDrawer);
  dom.drawerCloseBtn.addEventListener("click", closeDrawer);
}

// 切换设计模式
function switchMode(newMode) {
  if (state.mode === newMode) return;
  state.mode = newMode;
  
  // 更新切换器按钮状态
  dom.switcherBtns.forEach((btn) => {
    const btnMode = parseInt(btn.getAttribute("data-mode-btn"), 10);
    btn.classList.toggle("is-active", btnMode === newMode);
  });

  render();
}

// 核心渲染函数
function render() {
  // 设置根节点样式类
  dom.docContainer.className = `investigation-document mode-${
    state.mode === 1 ? "editorial" : state.mode === 2 ? "interactive" : "hybrid"
  }`;

  dom.docContainer.innerHTML = `
    <!-- Header: 严肃学术调查手记 -->
    <header class="doc-header">
      <div class="doc-brand">《红鲱鱼与枪》 调查档案 · ${state.mode === 1 ? "Mode 1 Editorial" : state.mode === 2 ? "Mode 2 Interactive" : "Mode 3 Hybrid"}</div>
      <div class="doc-meta">立案时间：${INVESTIGATION_CASE.checkedAt}</div>
    </header>

    <!-- 结论区: Conclusion Emergence (Mode 3 特性) -->
    ${renderConclusionSection()}

    <!-- 原始说法: Quote 语义区 (包含 Claim Trace 目标) -->
    ${renderOriginalQuoteSection()}

    <!-- 命题章节与证据列表 -->
    <main class="claims-container">
      ${INVESTIGATION_CASE.claims.map((claim, idx) => renderClaimChapter(claim, idx)).join("")}
    </main>
  `;

  // 绑定动态生成的 DOM 事件（Hover / Focus / Click）
  attachDynamicHandlers();
}

// 渲染结论区
function renderConclusionSection() {
  const isComplete = state.phase === "complete";
  const c = INVESTIGATION_CASE.conclusion;

  if (state.mode === 3) {
    // Mode 3: Conclusion Emergence 容器
    return `
      <section class="conclusion-region conclusion-emergence-container" style="max-height: ${isComplete ? "400px" : "0"}; opacity: ${isComplete ? "1" : "0"}; pointer-events: ${isComplete ? "auto" : "none"};">
        <div class="conclusion-lede">
          <span class="conclusion-label">调查结论 · directAnswer</span>
          <h1 class="conclusion-direct-answer">${c.directAnswer}</h1>
          <p class="conclusion-summary">${c.summary}</p>
          <div class="conclusion-boundary">
            <strong>判定边界：</strong>${c.boundaries}
          </div>
        </div>
      </section>
    `;
  }

  // Mode 1 & Mode 2
  if (!isComplete) {
    return `
      <section class="conclusion-region" style="padding: 16px; background: #fafafa; border-left: 3px solid #71717a; margin-bottom: 32px;">
        <span class="conclusion-label" style="color: #71717a;">调查进行中</span>
        <div style="font-size: 14px; color: #52525b;">正在逐条追查公开证据并核对命题，结论将在证据稳定后形成…</div>
      </section>
    `;
  }

  return `
    <section class="conclusion-region">
      <div class="conclusion-lede">
        <span class="conclusion-label">调查结论 · directAnswer</span>
        <h1 class="conclusion-direct-answer">${c.directAnswer}</h1>
        <p class="conclusion-summary">${c.summary}</p>
        <div class="conclusion-boundary">
          <strong>判定边界：</strong>${c.boundaries}
        </div>
      </div>
    </section>
  `;
}

// 渲染原始说法 Blockquote (支持 Claim Trace)
function renderOriginalQuoteSection() {
  const quoteHtml = INVESTIGATION_CASE.quoteTokens
    .map((token) => {
      if (token.isSpan) {
        return `<mark class="trace-span ${state.activeTraceClaimId === token.claimId ? "is-highlighted" : ""}" data-trace-claim="${token.claimId}">${token.text}</mark>`;
      }
      return token.text;
    })
    .join("");

  return `
    <section class="original-quote-section" aria-label="原始说法引用">
      <div class="original-quote-label">原始核查说法（对照基准）</div>
      <blockquote class="original-quote-body">“${quoteHtml}”</blockquote>
    </section>
  `;
}

// 渲染命题章节
function renderClaimChapter(claim, index) {
  const isComplete = state.phase === "complete";
  const statusLabel = isComplete ? claim.judgmentLabel : "正在检索比对";
  const statusClass = isComplete ? `is-${claim.judgment}` : "is-investigating";

  return `
    <article class="claim-chapter" id="chapter-${claim.id}" data-claim-id="${claim.id}">
      <div class="claim-header" tabindex="0" role="region" aria-label="命题 ${claim.num}: ${claim.text}">
        <span class="claim-num">${claim.num}</span>
        <div class="claim-title-group">
          <h2 class="claim-text">${claim.text}</h2>
        </div>
        <span class="claim-type-tag">${claim.typeLabel}</span>
        <span class="claim-status-chip ${statusClass}">${statusLabel}</span>
      </div>

      <!-- 证据空间 -->
      <div class="evidence-space" id="space-${claim.id}">
        ${renderEvidenceGroups(claim)}
      </div>

      <!-- 争点 (Conflict) -->
      ${claim.conflict && isComplete ? renderConflictNote(claim.conflict) : ""}

      <!-- 证据缺口 (Evidence Gap) -->
      ${claim.evidenceGaps && claim.evidenceGaps.length > 0 && isComplete ? renderGapNote(claim.evidenceGaps[0]) : ""}
    </article>
  `;
}

// 渲染证据分组与证据行
function renderEvidenceGroups(claim) {
  const isComplete = state.phase === "complete";

  // 如果处于调查中阶段，所有证据以 "待核对 ◌" 归在一组
  if (!isComplete) {
    return `
      <div class="evidence-group is-unassessed" data-group-role="unassessed">
        <div class="evidence-group-title">
          <span class="group-dot">◌</span> 待核对材料 (${claim.evidenceLinks.length})
        </div>
        <div class="evidence-list" id="list-${claim.id}-unassessed">
          ${claim.evidenceLinks.map((link) => renderEvidenceRow(link, "unassessed")).join("")}
        </div>
      </div>
    `;
  }

  // 完成态：按 support / contradict / context-only 分组
  const roles = [
    { key: "support", label: "支持依据", dot: "●" },
    { key: "contradict", label: "反驳依据", dot: "●" },
    { key: "context-only", label: "相关背景材料", dot: "○" }
  ];

  return roles
    .map(({ key, label, dot }) => {
      const links = claim.evidenceLinks.filter((l) => l.role === key);
      if (links.length === 0) return "";
      return `
        <div class="evidence-group is-${key}" data-group-role="${key}">
          <div class="evidence-group-title">
            <span class="group-dot">${dot}</span> ${label} (${links.length})
          </div>
          <div class="evidence-list" id="list-${claim.id}-${key}">
            ${links.map((link) => renderEvidenceRow(link, key)).join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

// 渲染单个证据条
function renderEvidenceRow(link, role) {
  const source = INVESTIGATION_CASE.sources[link.sourceId];
  if (!source) return "";

  const dot = role === "support" || role === "contradict" ? "●" : role === "context-only" ? "○" : "◌";

  return `
    <button type="button" 
      class="evidence-row is-${role}" 
      id="evidence-row-${source.id}"
      data-source-id="${source.id}"
      data-role="${role}"
      aria-label="查看出处：${source.title}">
      <span class="evidence-role-dot" aria-hidden="true">${dot}</span>
      <div class="evidence-row-body">
        <div class="evidence-row-header">
          <strong class="evidence-title">${source.title}</strong>
          <span class="evidence-domain">${source.domain} ↗</span>
        </div>
        <p class="evidence-excerpt">${source.excerpt}</p>
      </div>
    </button>
  `;
}

// 渲染争点
function renderConflictNote(conflict) {
  return `
    <div class="conflict-note" role="note" aria-label="关键争点">
      <div class="conflict-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm1 7.5H7v-5h2v5z"/></svg>
        关键争点 · ${conflict.title}
      </div>
      <div class="conflict-reason">${conflict.reason}</div>
      <p class="conflict-detail">${conflict.detail}</p>
    </div>
  `;
}

// 渲染证据缺口
function renderGapNote(gapText) {
  return `
    <div class="gap-note" role="note" aria-label="证据缺口">
      <strong>证据缺口：</strong>${gapText}
    </div>
  `;
}

// 挂载动态交互处理器
function attachDynamicHandlers() {
  // 1. Mode 3: Claim Trace (Hover / Focus 联动高亮原句中的 span)
  if (state.mode === 3) {
    document.querySelectorAll(".claim-chapter").forEach((chapter) => {
      const claimId = chapter.getAttribute("data-claim-id");

      const onEnter = () => {
        state.activeTraceClaimId = claimId;
        updateTraceHighlight();
      };
      const onLeave = () => {
        state.activeTraceClaimId = null;
        updateTraceHighlight();
      };

      chapter.addEventListener("mouseenter", onEnter);
      chapter.addEventListener("mouseleave", onLeave);
      chapter.addEventListener("focusin", onEnter);
      chapter.addEventListener("focusout", onLeave);
    });
  }

  // 2. 点击证据条打开 Source Drawer / Sheet
  document.querySelectorAll(".evidence-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sourceId = btn.getAttribute("data-source-id");
      openDrawer(sourceId, btn);
    });
  });
}

// 更新原句高亮 (Claim Trace)
function updateTraceHighlight() {
  document.querySelectorAll(".trace-span").forEach((span) => {
    const spanClaimId = span.getAttribute("data-trace-claim");
    if (state.activeTraceClaimId && spanClaimId === state.activeTraceClaimId) {
      span.classList.add("is-highlighted");
    } else {
      span.classList.remove("is-highlighted");
    }
  });
}

// 触发 Evidence Settling 物理位移动画 (FLIP 机制演示)
function triggerSettlingAnimation() {
  // 步骤 1: 先切换为 investigating 阶段，渲染出 待核对 列表
  state.phase = "investigating";
  render();

  // 记录所有证据条在待核对组中的 First 坐标
  const firstRects = new Map();
  document.querySelectorAll(".evidence-row").forEach((el) => {
    const id = el.getAttribute("data-source-id");
    firstRects.set(id, el.getBoundingClientRect());
  });

  // 步骤 2: 延时 300ms 后切换到 complete 状态（模拟核查完成并分类）
  setTimeout(() => {
    state.phase = "complete";
    render();

    // 步骤 3: 计算 Last 坐标并应用 Invert + Play
    document.querySelectorAll(".evidence-row").forEach((el) => {
      const id = el.getAttribute("data-source-id");
      const firstRect = firstRects.get(id);
      if (!firstRect) return;

      const lastRect = el.getBoundingClientRect();
      const deltaX = firstRect.left - lastRect.left;
      const deltaY = firstRect.top - lastRect.top;

      // 如果开启了 prefers-reduced-motion，不执行位移
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      // Invert: 瞬间移回原位
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      el.style.transition = "none";

      // Play: 下一帧平滑滑回新位置
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "transform 360ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms ease";
          el.style.transform = "translate(0, 0)";
        });
      });
    });
  }, 400);
}

// 打开 Source Drawer
function openDrawer(sourceId, triggerElement) {
  const source = INVESTIGATION_CASE.sources[sourceId];
  if (!source) return;

  state.activeDrawerSourceId = sourceId;
  state.lastFocusedElement = triggerElement;

  dom.drawerBody.innerHTML = `
    <h3 class="drawer-source-title">${source.title}</h3>
    
    <div class="drawer-field">
      <span class="drawer-field-label">核对针对的目标命题</span>
      <div class="drawer-field-content"><strong>${source.targetClaim}</strong></div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">原文精确摘录 (Exact Excerpt)</span>
      <div class="drawer-field-content is-excerpt">${source.excerpt}</div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">为什么它与该命题有关 (Relevance)</span>
      <div class="drawer-field-content">${source.relevanceReason}</div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">它不能证明什么 (Boundary / Limitations)</span>
      <div class="drawer-field-content is-boundary">${source.limitations}</div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">来源出处域名</span>
      <div class="drawer-field-content" style="font-family: var(--font-mono); font-size: 13px;">${source.domain}</div>
    </div>
  `;

  // 绑定外链按钮
  const externalLink = document.getElementById("drawer-external-link");
  if (externalLink) {
    externalLink.href = source.url;
  }

  // 激活抽屉与遮罩
  dom.drawerScrim.classList.add("is-open");
  dom.sourceDrawer.classList.add("is-open");
  dom.sourceDrawer.setAttribute("aria-hidden", "false");

  // 将焦点置入抽屉关闭按钮
  dom.drawerCloseBtn.focus();
}

// 关闭 Source Drawer (保证可访问性焦点精确恢复)
function closeDrawer() {
  state.activeDrawerSourceId = null;

  dom.drawerScrim.classList.remove("is-open");
  dom.sourceDrawer.classList.remove("is-open");
  dom.sourceDrawer.setAttribute("aria-hidden", "true");

  // 焦点精确恢复到刚才点击的 Evidence 按钮
  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

// 启动执行
document.addEventListener("DOMContentLoaded", init);
