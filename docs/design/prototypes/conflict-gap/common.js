/*
 * 共享：DOM 小工具、产品上下文取景、来源抽屉。
 * 变体只负责渲染 .gp-claim-detail 里的内容。
 */
window.RHG = (function () {
  const D = window.RHG_DATA;

  function h(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child == null || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  function source(id) {
    const s = D.sources[id];
    if (!s) throw new Error("unknown source: " + id);
    return s;
  }

  /** 证据行：左侧关系标签 + 标题/域名 + 摘录。与产品 EvidenceItem 同构。 */
  function evidenceRow(item, options) {
    const opts = options || {};
    const s = source(item.sourceId);
    const row = h("button", "gp-evidence-item");
    row.type = "button";
    row.dataset.sourceId = item.sourceId;
    row.dataset.role = item.relation;

    if (opts.showRelation !== false) {
      const glyph = item.relation === "context-only" ? "○" : "●";
      const relation = h("span", "gp-evidence-relation is-" + item.relation);
      relation.append(
        h("span", "gp-role-glyph is-" + item.relation, glyph),
        h("span", "gp-evidence-relation-label", item.relationLabel)
      );
      row.append(relation);
    }

    const body = h("span", "gp-evidence-body");
    const header = h("span", "gp-evidence-header");
    header.append(
      h("span", "gp-evidence-title", s.title),
      h("span", "gp-evidence-domain", [s.domain, h("span", "gp-ext-arrow", " ↗")])
    );
    body.append(header, h("span", "gp-evidence-excerpt", s.excerpt));
    row.append(body);
    return row;
  }

  /** 按 sourceId 取到分组里的证据条目并渲染成行（争点栏用：不带关系标签）。 */
  function rowForSourceId(sourceId, fallbackRelation) {
    const item = D.groups
      .flatMap(function (group) { return group.items; })
      .find(function (entry) { return entry.sourceId === sourceId; }) || {
      sourceId: sourceId,
      relation: fallbackRelation || "context-only",
      relationLabel: "",
    };
    return evidenceRow(item, { showRelation: false });
  }

  function groupHead(group) {
    const head = h("div", "gp-evidence-group-head");
    head.dataset.groupHead = group.role;
    head.append(
      h("span", "gp-role-glyph is-" + group.role, group.glyph),
      h("h4", "gp-evidence-group-label", group.label),
      h("span", "gp-evidence-group-count", "· " + group.items.length)
    );
    return head;
  }

  function groupList(group) {
    const list = h("div", "gp-evidence-list");
    list.dataset.groupRows = group.role;
    for (const item of group.items) list.append(evidenceRow(item));
    return list;
  }

  /** 一组「分组头 + 行」的可寻址单元（V3 往里面追加补查到的材料）。 */
  function evidenceGroup(group) {
    const wrap = h("div", "gp-evidence-group");
    wrap.append(groupHead(group), groupList(group));
    return wrap;
  }

  function renderBoard(groups, options) {
    const board = h("div", "gp-evidence-board");
    for (const group of groups) board.append(evidenceGroup(group));
    if (options && options.slot) board.append(options.slot);
    return board;
  }

  function refreshCount(board, role) {
    const head = board.querySelector('[data-group-head="' + role + '"] .gp-evidence-group-count');
    const rows = board.querySelectorAll('[data-group-rows="' + role + '"] .gp-evidence-item');
    if (head) head.textContent = "· " + rows.length;
  }

  function gapAnnotation(gap) {
    const aside = h("aside", "gp-gaps");
    aside.setAttribute("aria-label", "尚缺");
    const head = h("div", "gp-gaps-head");
    head.append(h("h4", "gp-gaps-label", "尚缺"), h("span", "gp-gaps-count", "· 1"));
    const list = h("ul", "gp-gaps-list");
    const item = h("li", "gp-gap-item");
    item.append(h("strong", "gp-gap-desc", gap.description), h("span", "gp-gap-consequence", gap.consequence));
    list.append(item);
    aside.append(head, list);
    return aside;
  }

  function conflictAnnotation(conflict) {
    const section = h("section", "gp-conflict");
    const head = h("div", "gp-conflict-head");
    head.append(h("span", "gp-conflict-tag", "争点"), h("h4", "gp-conflict-label", "存在争议"));
    const summary = h("p", "gp-conflict-summary", conflict.summary);
    const sides = h("p", "gp-conflict-sides");
    const sideButton = h("button", "gp-conflict-side", "两边的材料各有一条");
    sideButton.type = "button";
    const firstSourceId = conflict.sides[0].sourceIds[0];
    sideButton.dataset.sourceId = firstSourceId;
    sides.append(sideButton);
    const reasonWrap = h("div", "gp-conflict-reason-wrap");
    reasonWrap.append(h("strong", "gp-conflict-reason-lead", "争点在哪："));
    if (conflict.reasonStatus === "known" && conflict.reason) {
      reasonWrap.append(h("span", "gp-conflict-reason", conflict.reason));
    } else {
      reasonWrap.append(h("span", "gp-conflict-reason is-unknown", "双方材料并存，分歧的原因目前还不清楚。"));
    }
    section.append(head, summary, sides, reasonWrap);
    return section;
  }

  function boundaryLine(text) {
    const p = h("p", "gp-boundary");
    p.append(h("strong", null, "边界"), text);
    return p;
  }

  /** 像素角色头像（2026-09-11 视觉人格修正案后解禁；只站材料状态位，不进执行流程）。 */
  function avatar(name, sizeClass) {
    const img = h("img", "gp-avatar" + (sizeClass ? " is-" + sizeClass : ""));
    img.src = "./avatars/" + name + ".png";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    return img;
  }

  function docHead() {
    const head = h("header", "doc-head");
    head.append(
      h("p", "doc-kicker", "你调查的说法"),
      h("h1", "doc-claim", D.originalClaim),
      h("p", "doc-meta", D.meta)
    );
    return head;
  }

  function contextClaimRow() {
    const article = h("article", "gp-claim is-collapsed-context");
    const head = h("div", "gp-claim-head");
    const body = h("span", "gp-claim-body");
    body.append(h("strong", "gp-claim-text", D.contextClaim.text));
    const side = h("span", "gp-claim-side");
    side.append(
      h("span", "gp-chip gp-chip--" + D.contextClaim.chipTone, D.contextClaim.chip),
      h("span", "gp-claim-toggle", "展开")
    );
    head.append(h("span", "gp-claim-num", D.contextClaim.num), body, side);
    article.append(head);
    return article;
  }

  function targetClaimHead() {
    const head = h("div", "gp-claim-head");
    const body = h("span", "gp-claim-body");
    body.append(h("strong", "gp-claim-text", D.claim.text));
    const side = h("span", "gp-claim-side");
    side.append(
      h("span", "gp-chip gp-chip--" + D.claim.chipTone, D.claim.chip),
      h("span", "gp-claim-toggle", "收起")
    );
    head.append(h("span", "gp-claim-num", D.claim.num), body, side);
    return head;
  }

  /* ---------- 来源抽屉 ---------- */

  let drawerRefs = null;

  function buildDrawer() {
    const scrim = h("div", "drawer-scrim");
    scrim.setAttribute("aria-hidden", "true");

    const el = h("aside", "source-drawer");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "drawer-title");

    const head = h("header", "drawer-head");
    const kicker = h("span", "drawer-kicker");
    const close = h("button", "drawer-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    head.append(kicker, close);

    const title = h("h3", "drawer-title");
    title.id = "drawer-title";
    const domain = h("p", "drawer-domain");
    const excerpt = h("blockquote", "drawer-excerpt");
    const link = h("a", "drawer-link", "打开原始网页 ↗");
    link.target = "_blank";
    link.rel = "noreferrer";

    el.append(head, title, domain, excerpt, link);
    return { scrim, el, kicker, close, title, domain, excerpt, link };
  }

  const ROLE_TEXT = {
    support: "支持",
    contradict: "反驳",
    unassessed: "待核对",
    "context-only": "相关",
  };

  function openDrawer(sourceId, role, relationLabel) {
    if (!drawerRefs) return;
    const s = source(sourceId);
    const d = drawerRefs;
    const label = relationLabel || ROLE_TEXT[role] || "相关";
    d.kicker.textContent = "对这条命题 · " + label;
    d.kicker.className = "drawer-kicker is-" + (role || "context-only");
    d.title.textContent = s.title;
    d.domain.textContent = s.domain;
    d.excerpt.textContent = s.excerpt;
    d.link.href = s.url;
    d.scrim.classList.add("is-open");
    d.el.classList.add("is-open");
    d.lastTrigger = document.activeElement;
    d.close.focus();
  }

  function closeDrawer() {
    if (!drawerRefs) return;
    const d = drawerRefs;
    d.scrim.classList.remove("is-open");
    d.el.classList.remove("is-open");
    if (d.lastTrigger && d.lastTrigger.focus) d.lastTrigger.focus();
  }

  function wireDrawer(drawer) {
    drawerRefs = drawer;
    drawer.close.addEventListener("click", closeDrawer);
    drawer.scrim.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDrawer();
    });
    document.getElementById("stage").addEventListener("click", function (event) {
      const row = event.target.closest("[data-source-id]");
      if (!row) return;
      const relation = row.querySelector(".gp-evidence-relation-label");
      openDrawer(row.dataset.sourceId, row.dataset.role, relation ? relation.textContent : "");
    });
  }

  /** 取景：真实的文书上下文 + 变体渲染区。返回 detail 容器。 */
  function mountStage(renderDetail) {
    const stage = document.getElementById("stage");
    stage.innerHTML = "";
    const doc = h("div", "doc");
    doc.append(docHead(), contextClaimRow());

    const article = h("article", "gp-claim");
    article.append(targetClaimHead());
    const detail = h("div", "gp-claim-detail");
    article.append(detail);
    doc.append(article);

    const drawer = buildDrawer();
    stage.append(doc, drawer.scrim, drawer.el);
    wireDrawer(drawer);

    renderDetail(detail);
    return detail;
  }

  return {
    h: h,
    source: source,
    evidenceRow: evidenceRow,
    rowForSourceId: rowForSourceId,
    evidenceGroup: evidenceGroup,
    renderBoard: renderBoard,
    refreshCount: refreshCount,
    gapAnnotation: gapAnnotation,
    conflictAnnotation: conflictAnnotation,
    boundaryLine: boundaryLine,
    avatar: avatar,
    mountStage: mountStage,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
  };
})();

window.RHG_VARIANTS = window.RHG_VARIANTS || [];
