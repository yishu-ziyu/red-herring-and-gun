/*
 * 第二轮 · 片段
 * 轴：信息层级 —— 对不上的其实是两句话，不是两个标题。
 * 摘录领衔，来源标题与域名退到下方小字；两栏依旧可悬停对读、可点开。
 */
(function () {
  const D = window.RHG_DATA;
  const RHG = window.RHG;
  const h = RHG.h;

  function snippetRow(sourceId, relation) {
    const s = RHG.source(sourceId);
    const row = h("button", "gp-evidence-item snip-row");
    row.type = "button";
    row.dataset.sourceId = sourceId;
    row.dataset.role = relation;

    const body = h("span", "gp-evidence-body");
    body.append(h("span", "snip-quote", s.excerpt));

    const source = h("span", "snip-source");
    source.append(
      h("span", "snip-source-title", s.title),
      h("span", "gp-evidence-domain", [s.domain, h("span", "gp-ext-arrow", " ↗")])
    );
    body.append(source);
    row.append(body);
    return row;
  }

  function render() {
    RHG.mountStage(function (detail) {
      const section = h("section", "snip-cols");

      function side(def) {
        const col = h("div", "snip-side is-" + def.position);
        const head = h("header", "snip-side-head");
        head.append(
          h("span", "gp-role-glyph is-" + def.position, "●"),
          h("h4", null, def.label),
          h("span", "seam-side-count", def.sourceIds.length + " 条")
        );
        col.append(head);
        def.sourceIds.forEach(function (sourceId) {
          col.append(snippetRow(sourceId, def.position));
        });
        return col;
      }

      const support = D.conflict.sides.find(function (s) { return s.position === "support"; });
      const contradict = D.conflict.sides.find(function (s) { return s.position === "contradict"; });
      section.append(side(support), side(contradict));

      const note = h("p", "v1-seam-note");
      note.append(h("strong", null, "争点在哪："), D.conflict.reason);

      detail.append(section, note, RHG.gapAnnotation(D.gap), RHG.boundaryLine(D.claim.boundary));
    });
  }

  window.RHG_VARIANTS.push({ name: "片段", render: render });
})();
