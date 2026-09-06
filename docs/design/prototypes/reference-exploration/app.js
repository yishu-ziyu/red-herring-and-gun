/**
 * 《红鲱鱼与枪》 · Design Exploration Playground 交互核心
 * 
 * 核心架构要求：
 * 1. Persistent DOM Identity: Evidence 节点在整个生命周期中只创建一次，Settling 是在同一 HTMLElement 上完成挂载移动与 FLIP。
 * 2. Conclusion Emergence: 同一个 Conclusion 容器节点，通过 layout 与 opacity 自然浮现，不通过重新构建 DOM 制造效果。
 * 3. Claim Trace: 纯确定性函数 buildTraceSegments(originalQuote, claims)，严格由 originalSpan 驱动，不使用任何手写 token 映射。
 * 4. Quiet Editorial Source Drawer: 真正的 Modal Focus Containment (Tab 闭环锁定、Escape 关闭、Focus 精确归位、背景 inert)。
 */

import { PRODUCTION_SHAPED_FIXTURE } from "./data.js";

// 全局响应式状态
const state = {
  mode: 3, // 1: Editorial, 2: Interactive, 3: Hybrid (推荐)
  phase: "complete", // "investigating" | "complete"
  activeDrawerSourceId: null,
  activeTraceClaimId: null,
  isMobileSimulated: false,
  lastFocusedElement: null
};

// 持久 DOM 节点与映射缓存
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
  drawerBody: document.getElementById("drawer-body"),
  drawerExternalLink: document.getElementById("drawer-external-link"),
  
  // 单例持久节点
  conclusionRegion: null,
  claimsContainer: null,
  originalQuoteSection: null
};

// 内存中唯一的 Evidence HTMLElement 映射：Map<sourceId, HTMLElement>
const evidenceNodesMap = new Map();

/**
 * 确定性生成 Claim Trace 切片
 * 唯一输入：originalQuote + claims[].originalSpan
 * 规则：
 * - 合法 originalSpan [start, end] 精确映射；
 * - 无 originalSpan 或 null/undefined 则不高亮；
 * - 越界 span 自动忽略；
 * - 重叠 spans 确定性非重叠截断，绝不破坏 DOM；
 * - 绝不存在第二套手写映射。
 */
export function buildTraceSegments(originalQuote, claims) {
  if (!originalQuote || typeof originalQuote !== "string") return [];
  if (!Array.isArray(claims)) return [{ text: originalQuote, claimId: null, isSpan: false }];

  // 1. 筛选并校验有效 span
  const validSpans = [];
  for (const claim of claims) {
    if (!claim.originalSpan || !Array.isArray(claim.originalSpan) || claim.originalSpan.length !== 2) {
      continue;
    }
    const [start, end] = claim.originalSpan;
    if (typeof start !== "number" || typeof end !== "number") continue;
    // 严格范围校验
    if (start < 0 || end > originalQuote.length || start >= end) continue;
    validSpans.push({ start, end, claimId: claim.id });
  }

  // 2. 按起始位置升序排序
  validSpans.sort((a, b) => a.start - b.start);

  // 3. 确定性解决重叠 (non-overlapping resolution)
  const nonOverlapping = [];
  let lastEnd = 0;
  for (const span of validSpans) {
    if (span.start >= lastEnd) {
      nonOverlapping.push(span);
      lastEnd = span.end;
    } else if (span.end > lastEnd) {
      // 截断冲突区域，保留未重叠部分
      nonOverlapping.push({ start: lastEnd, end: span.end, claimId: span.claimId });
      lastEnd = span.end;
    }
  }

  // 4. 切片生成连续文本序列
  const segments = [];
  let cursor = 0;
  for (const span of nonOverlapping) {
    if (span.start > cursor) {
      segments.push({
        text: originalQuote.slice(cursor, span.start),
        claimId: null,
        isSpan: false
      });
    }
    segments.push({
      text: originalQuote.slice(span.start, span.end),
      claimId: span.claimId,
      isSpan: true
    });
    cursor = span.end;
  }
  if (cursor < originalQuote.length) {
    segments.push({
      text: originalQuote.slice(cursor),
      claimId: null,
      isSpan: false
    });
  }

  return segments;
}

// 初始化
function init() {
  buildPersistentDOMTree();
  bindGlobalEvents();
  syncPhaseState(false); // 初始同步状态（无动画）
}

/**
 * 一次性构建持久 DOM 结构
 * 之后的所有状态变更均在已有节点上操作，绝不重新 innerHTML 销毁树
 */
function buildPersistentDOMTree() {
  dom.docContainer.className = `investigation-document mode-${getModeClass(state.mode)}`;
  dom.docContainer.innerHTML = "";

  // 1. Header
  const header = document.createElement("header");
  header.className = "doc-header";
  header.innerHTML = `
    <div class="doc-brand" id="doc-brand-title">《红鲱鱼与枪》 调查档案 · ${getModeName(state.mode)}</div>
    <div class="doc-meta">立案时间：${PRODUCTION_SHAPED_FIXTURE.checkedAt}</div>
  `;
  dom.docContainer.appendChild(header);

  // 2. Conclusion Region (持久单例节点)
  const c = PRODUCTION_SHAPED_FIXTURE.conclusion;
  dom.conclusionRegion = document.createElement("section");
  dom.conclusionRegion.className = "conclusion-region";
  dom.conclusionRegion.setAttribute("aria-label", "调查结论");
  dom.conclusionRegion.innerHTML = `
    <div class="conclusion-lede">
      <span class="conclusion-label">调查结论 · directAnswer</span>
      <h1 class="conclusion-direct-answer">${c.directAnswer}</h1>
      <p class="conclusion-summary">${c.summary}</p>
      <div class="conclusion-boundary">
        <strong>判定边界：</strong>${c.boundaries}
      </div>
    </div>
  `;
  dom.docContainer.appendChild(dom.conclusionRegion);

  // 3. 原始核查说法 (由 buildTraceSegments 唯一生成)
  dom.originalQuoteSection = document.createElement("section");
  dom.originalQuoteSection.className = "original-quote-section";
  dom.originalQuoteSection.setAttribute("aria-label", "原始说法引用");
  
  const segments = buildTraceSegments(
    PRODUCTION_SHAPED_FIXTURE.originalQuote,
    PRODUCTION_SHAPED_FIXTURE.claims
  );

  const quoteBody = document.createElement("blockquote");
  quoteBody.className = "original-quote-body";
  quoteBody.appendChild(document.createTextNode("“"));
  for (const seg of segments) {
    if (seg.isSpan && seg.claimId) {
      const mark = document.createElement("mark");
      mark.className = "trace-span";
      mark.setAttribute("data-trace-claim", seg.claimId);
      mark.textContent = seg.text;
      quoteBody.appendChild(mark);
    } else {
      quoteBody.appendChild(document.createTextNode(seg.text));
    }
  }
  quoteBody.appendChild(document.createTextNode("”"));

  dom.originalQuoteSection.innerHTML = `<div class="original-quote-label">原始核查说法（对照基准）</div>`;
  dom.originalQuoteSection.appendChild(quoteBody);
  dom.docContainer.appendChild(dom.originalQuoteSection);

  // 4. 命题与证据容器 (Claims Container)
  dom.claimsContainer = document.createElement("main");
  dom.claimsContainer.className = "claims-container";

  for (const claim of PRODUCTION_SHAPED_FIXTURE.claims) {
    const article = document.createElement("article");
    article.className = "claim-chapter";
    article.id = `chapter-${claim.id}`;
    article.setAttribute("data-claim-id", claim.id);

    // 命题 Header
    const head = document.createElement("div");
    head.className = "claim-header";
    head.tabIndex = 0;
    head.setAttribute("role", "region");
    head.setAttribute("aria-label", `命题 ${claim.num}: ${claim.text}`);
    head.innerHTML = `
      <span class="claim-num">${claim.num}</span>
      <div class="claim-title-group">
        <h2 class="claim-text">${claim.text}</h2>
      </div>
      <span class="claim-type-tag">${claim.typeLabel}</span>
      <span class="claim-status-chip is-${claim.judgment}" id="chip-${claim.id}">
        ${claim.judgmentLabel}
      </span>
    `;

    // Claim Trace Hover 联动 (真实 originalSpan 触发)
    head.addEventListener("mouseenter", () => setTraceHighlight(claim.id));
    head.addEventListener("mouseleave", () => setTraceHighlight(null));
    head.addEventListener("focusin", () => setTraceHighlight(claim.id));
    head.addEventListener("focusout", () => setTraceHighlight(null));

    article.appendChild(head);

    // 证据空间与持久分组容器
    const evidenceSpace = document.createElement("div");
    evidenceSpace.className = "evidence-space";
    evidenceSpace.id = `space-${claim.id}`;

    // 预建 4 个持久分组容器 (Unassessed, Support, Contradict, Context-only)
    const groupsConfig = [
      { key: "unassessed", label: "待核对材料", dot: "◌" },
      { key: "support", label: "支持依据", dot: "●" },
      { key: "contradict", label: "反驳依据", dot: "●" },
      { key: "context-only", label: "相关背景材料", dot: "○" }
    ];

    for (const g of groupsConfig) {
      const gEl = document.createElement("div");
      gEl.className = `evidence-group is-${g.key}`;
      gEl.id = `group-${claim.id}-${g.key}`;
      gEl.setAttribute("data-group-role", g.key);
      gEl.innerHTML = `
        <div class="evidence-group-title">
          <span class="group-dot">${g.dot}</span>
          <span class="group-label">${g.label}</span>
          <span class="group-count" id="count-${claim.id}-${g.key}"></span>
        </div>
        <div class="evidence-list" id="list-${claim.id}-${g.key}"></div>
      `;
      evidenceSpace.appendChild(gEl);
    }

    // 实例化本 Claim 下的所有 Evidence Row 节点，并放入 Map 缓存（唯一实例）
    for (const link of claim.evidenceLinks) {
      const source = PRODUCTION_SHAPED_FIXTURE.sources[link.sourceId];
      if (source && !evidenceNodesMap.has(link.sourceId)) {
        const rowNode = createPersistentEvidenceNode(link, source, claim);
        evidenceNodesMap.set(link.sourceId, rowNode);
      }
    }

    article.appendChild(evidenceSpace);

    // 争点 (Conflict)
    if (claim.conflict) {
      const conflictEl = document.createElement("div");
      conflictEl.className = "conflict-note";
      conflictEl.id = `conflict-${claim.id}`;
      conflictEl.setAttribute("role", "note");
      conflictEl.innerHTML = `
        <div class="conflict-header">关键争点 · ${claim.conflict.title}</div>
        <div class="conflict-reason">${claim.conflict.reason}</div>
        <p class="conflict-detail">${claim.conflict.detail}</p>
      `;
      article.appendChild(conflictEl);
    }

    // 证据缺口 (Gap)
    if (claim.evidenceGaps && claim.evidenceGaps.length > 0) {
      const gapEl = document.createElement("div");
      gapEl.className = "gap-note";
      gapEl.id = `gap-${claim.id}`;
      gapEl.setAttribute("role", "note");
      gapEl.innerHTML = `<strong>证据缺口：</strong>${claim.evidenceGaps[0]}`;
      article.appendChild(gapEl);
    }

    dom.claimsContainer.appendChild(article);
  }

  dom.docContainer.appendChild(dom.claimsContainer);
}

/**
 * 创建单例 Evidence Row 节点（生命周期中只创建一次）
 */
function createPersistentEvidenceNode(link, source, claim) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "evidence-row";
  btn.id = `evidence-row-${source.id}`;
  btn.setAttribute("data-source-id", source.id);
  btn.setAttribute("data-role", link.role);
  btn.setAttribute("aria-label", `查看出处：${source.title}`);

  btn.innerHTML = `
    <span class="evidence-role-dot" aria-hidden="true">●</span>
    <div class="evidence-row-body">
      <div class="evidence-row-header">
        <strong class="evidence-title">${source.title}</strong>
        <span class="evidence-domain">${source.domain} ↗</span>
      </div>
      <p class="evidence-excerpt">${source.excerpt}</p>
    </div>
  `;

  // 点击打开 Source Drawer
  btn.addEventListener("click", () => openDrawer(source.id, btn, claim));

  return btn;
}

/**
 * 同步阶段状态 (investigating vs complete)
 * 关键要求：同一 DOM 节点移动 (appendChild)，不销毁重建
 */
function syncPhaseState(withAnimation = false) {
  const isComplete = state.phase === "complete";

  // 1. Conclusion Region: 持久节点平滑过渡
  if (isComplete) {
    dom.conclusionRegion.classList.remove("is-hidden");
    dom.conclusionRegion.classList.add("is-visible");
  } else {
    dom.conclusionRegion.classList.add("is-hidden");
    dom.conclusionRegion.classList.remove("is-visible");
  }

  // 2. 遍历所有 Claim，将持久存在的 Evidence 节点分拣到对应容器
  for (const claim of PRODUCTION_SHAPED_FIXTURE.claims) {
    const unassessedList = document.getElementById(`list-${claim.id}-unassessed`);
    const chip = document.getElementById(`chip-${claim.id}`);

    if (chip) {
      chip.textContent = isComplete ? claim.judgmentLabel : "正在核对中";
      chip.className = `claim-status-chip is-${isComplete ? claim.judgment : "investigating"}`;
    }

    // 争点与缺口可见性
    const conflictEl = document.getElementById(`conflict-${claim.id}`);
    if (conflictEl) conflictEl.style.display = isComplete ? "block" : "none";
    const gapEl = document.getElementById(`gap-${claim.id}`);
    if (gapEl) gapEl.style.display = isComplete ? "block" : "none";

    for (const link of claim.evidenceLinks) {
      const node = evidenceNodesMap.get(link.sourceId);
      if (!node) continue;

      const targetRole = isComplete ? link.role : "unassessed";
      const targetList = isComplete
        ? document.getElementById(`list-${claim.id}-${link.role}`)
        : unassessedList;

      // 仅在父容器改变时执行真实 DOM appendChild 移动
      if (node.parentElement !== targetList && targetList) {
        targetList.appendChild(node);
      }

      // 更新节点角色与小圆点内容
      node.setAttribute("data-role", targetRole);
      const dotEl = node.querySelector(".evidence-role-dot");
      if (dotEl) {
        dotEl.textContent = targetRole === "support" || targetRole === "contradict" ? "●" : targetRole === "context-only" ? "○" : "◌";
      }
    }

    // 更新各分组计数与显示/隐藏状态
    updateGroupCounts(claim, isComplete);
  }
}

/**
 * 更新分组标题计数与空分组隐藏
 */
function updateGroupCounts(claim, isComplete) {
  const roles = ["unassessed", "support", "contradict", "context-only"];
  for (const r of roles) {
    const groupEl = document.getElementById(`group-${claim.id}-${r}`);
    const listEl = document.getElementById(`list-${claim.id}-${r}`);
    const countEl = document.getElementById(`count-${claim.id}-${r}`);
    if (!groupEl || !listEl || !countEl) continue;

    const count = listEl.children.length;
    countEl.textContent = `(${count})`;

    if (count === 0) {
      groupEl.style.display = "none";
    } else {
      groupEl.style.display = "flex";
    }
  }
}

/**
 * 真实 Evidence Settling 动画 (FLIP 发生在同一个 HTMLElement 上)
 * 验证：before === after 严格相等！
 */
function triggerSettlingAnimation() {
  // 1. 先切换为 investigating 阶段，让所有节点回到 unassessed 容器
  state.phase = "investigating";
  syncPhaseState(false);

  // 2. First: 记录每个节点在未核对容器中的位置
  const firstRects = new Map();
  evidenceNodesMap.forEach((node, sourceId) => {
    firstRects.set(sourceId, node.getBoundingClientRect());
  });

  // 3. 延时 280ms 切换为 complete（同节点被 append 到各个目标容器中）
  setTimeout(() => {
    state.phase = "complete";
    syncPhaseState(false);

    // 判断用户是否开启了 reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 4. Last, Invert & Play: 在同一个 DOM 节点上执行 FLIP
    evidenceNodesMap.forEach((node, sourceId) => {
      if (prefersReducedMotion) return;

      const firstRect = firstRects.get(sourceId);
      if (!firstRect) return;

      const lastRect = node.getBoundingClientRect();
      const deltaX = firstRect.left - lastRect.left;
      const deltaY = firstRect.top - lastRect.top;

      // Invert
      node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      node.style.transition = "none";

      // Play
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          node.style.transition = "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)";
          node.style.transform = "translate(0, 0)";
        });
      });
    });
  }, 320);
}

/**
 * Claim Trace 高亮联动
 * 严格基于 originalSpan 生成的 mark 节点联动，无合法 span 则不高亮
 */
function setTraceHighlight(claimId) {
  state.activeTraceClaimId = claimId;
  const marks = dom.originalQuoteSection.querySelectorAll("mark.trace-span");
  marks.forEach((mark) => {
    const markClaim = mark.getAttribute("data-trace-claim");
    if (claimId && markClaim === claimId) {
      mark.classList.add("is-highlighted");
    } else {
      mark.classList.remove("is-highlighted");
    }
  });
}

/**
 * Source Drawer 打开 (Quiet Editorial 视觉 + 完整 Modal Focus Containment)
 */
function openDrawer(sourceId, triggerElement, claim) {
  const source = PRODUCTION_SHAPED_FIXTURE.sources[sourceId];
  if (!source) return;

  state.activeDrawerSourceId = sourceId;
  state.lastFocusedElement = triggerElement;

  // 填充 Quiet Editorial 纯净结构（无 semantic rainbow）
  dom.drawerBody.innerHTML = `
    <h3 class="drawer-source-title">${source.title}</h3>
    
    <div class="drawer-field">
      <span class="drawer-field-label">针对命题</span>
      <div class="drawer-field-content"><strong>${claim ? claim.num + " " + claim.text : source.targetClaim}</strong></div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">原文摘录</span>
      <div class="drawer-field-content is-excerpt">
        <blockquote>${source.excerpt}</blockquote>
      </div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">为什么这条证据重要</span>
      <div class="drawer-field-content">${source.relevanceReason}</div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">它不能证明什么</span>
      <div class="drawer-field-content is-boundary">${source.limitations}</div>
    </div>

    <div class="drawer-field">
      <span class="drawer-field-label">来源出处</span>
      <div class="drawer-field-content" style="font-family: var(--font-mono); font-size: 13px;">${source.domain}</div>
    </div>
  `;

  if (dom.drawerExternalLink) {
    dom.drawerExternalLink.href = source.url;
  }

  // 背景设为 inert（防止键盘 Tab 穿透到背景）
  dom.docContainer.setAttribute("inert", "");
  dom.drawerScrim.classList.add("is-open");
  dom.sourceDrawer.classList.add("is-open");
  dom.sourceDrawer.setAttribute("aria-hidden", "false");

  // 焦点移入抽屉内的首个可聚焦元素
  dom.drawerCloseBtn.focus();
}

/**
 * Source Drawer 关闭 (清理 inert，恢复焦点到刚才触发的 Evidence 按钮)
 */
function closeDrawer() {
  state.activeDrawerSourceId = null;

  dom.drawerScrim.classList.remove("is-open");
  dom.sourceDrawer.classList.remove("is-open");
  dom.sourceDrawer.setAttribute("aria-hidden", "true");

  // 恢复背景可交互
  dom.docContainer.removeAttribute("inert");

  // 恢复焦点
  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

/**
 * 全局事件绑定（包含 Tab 焦点陷阱 containment、Escape、快捷键 1/2/3）
 */
function bindGlobalEvents() {
  // 1. 键盘 1 / 2 / 3 切换模式
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "1") switchMode(1);
    if (e.key === "2") switchMode(2);
    if (e.key === "3") switchMode(3);

    // Escape 关闭抽屉
    if (e.key === "Escape" && state.activeDrawerSourceId) {
      closeDrawer();
    }
  });

  // 2. Drawer Focus Containment 捕获 (Tab 永远不离开抽屉)
  dom.sourceDrawer.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    const focusableElements = dom.sourceDrawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;

    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  });

  // 3. 顶部切换栏
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
      syncPhaseState(true);
    });
  }

  if (dom.viewportBtn) {
    dom.viewportBtn.addEventListener("click", () => {
      state.isMobileSimulated = !state.isMobileSimulated;
      dom.viewportBtn.textContent = state.isMobileSimulated ? "视口：390px (Mobile)" : "视口：1440px (Desktop)";
      dom.canvasWrapper.style.maxWidth = state.isMobileSimulated ? "390px" : "780px";
    });
  }

  dom.drawerScrim.addEventListener("click", closeDrawer);
  dom.drawerCloseBtn.addEventListener("click", closeDrawer);
}

// 切换模式（只切顶层 CSS class，不销毁 DOM）
function switchMode(newMode) {
  state.mode = newMode;
  dom.docContainer.className = `investigation-document mode-${getModeClass(newMode)}`;
  
  const title = document.getElementById("doc-brand-title");
  if (title) title.textContent = `《红鲱鱼与枪》 调查档案 · ${getModeName(newMode)}`;

  dom.switcherBtns.forEach((btn) => {
    const m = parseInt(btn.getAttribute("data-mode-btn"), 10);
    btn.classList.toggle("is-active", m === newMode);
  });
}

function getModeClass(mode) {
  return mode === 1 ? "editorial" : mode === 2 ? "interactive" : "hybrid";
}

function getModeName(mode) {
  return mode === 1 ? "Mode 1 Editorial" : mode === 2 ? "Mode 2 Interactive" : "Mode 3 Hybrid";
}

// 暴露全局 API 供自动化行为测试抓取
window.__RHG_PROTOTYPE__ = {
  state,
  evidenceNodesMap,
  getEvidenceNode: (sourceId) => evidenceNodesMap.get(sourceId),
  getConclusionNode: () => dom.conclusionRegion,
  triggerSettlingAnimation,
  syncPhaseState,
  openDrawer,
  closeDrawer,
  buildTraceSegments,
  fixture: PRODUCTION_SHAPED_FIXTURE
};

// 启动
document.addEventListener("DOMContentLoaded", init);
