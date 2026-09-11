/*
 * 第三轮 · 状态
 * 中等强度：四个角色各守一个材料状态位——拆题完成、两边材料对不上、这一格还空着、结论收束。
 * 角色出现的条件是材料状态，不是执行步骤；不写角色名、不表演“正在思考”。
 */
(function () {
  const D = window.RHG_DATA;
  const RHG = window.RHG;
  const h = RHG.h;

  function render() {
    RHG.mountStage(function (detail) {
      // 页眉：立案分诊员（这句话已经被拆成可核查的命题）
      const head = document.querySelector(".doc-head");
      const kicker = head.querySelector(".doc-kicker");
      kicker.classList.add("sig-kicker");
      kicker.prepend(RHG.avatar("rumor-detector", "md"));

      // 两栏材料（片段版式）
      const section = h("section", "snip-cols");
      function side(def) {
        const col = h("div", "snip-side is-" + def.position);
        const sideHead = h("header", "snip-side-head");
        sideHead.append(
          h("span", "gp-role-glyph is-" + def.position, "●"),
          h("h4", null, def.label),
          h("span", "seam-side-count", def.sourceIds.length + " 条")
        );
        col.append(sideHead);
        def.sourceIds.forEach(function (sourceId) {
          const s = RHG.source(sourceId);
          const row = h("button", "gp-evidence-item snip-row");
          row.type = "button";
          row.dataset.sourceId = sourceId;
          row.dataset.role = def.position;
          const body = h("span", "gp-evidence-body");
          body.append(h("span", "snip-quote", s.excerpt));
          const src = h("span", "snip-source");
          src.append(
            h("span", "snip-source-title", s.title),
            h("span", "gp-evidence-domain", [s.domain, h("span", "gp-ext-arrow", " ↗")])
          );
          body.append(src);
          row.append(body);
          col.append(row);
        });
        return col;
      }
      section.append(side(D.conflict.sides[0]), side(D.conflict.sides[1]));

      // 争点：信源审计员把两边材料并排核对，发现对不上
      const note = h("div", "state-line");
      note.append(RHG.avatar("source-validator", "sm"));
      const noteBody = h("p", "v1-seam-note");
      noteBody.append(h("strong", null, "争点在哪："), D.conflict.reason);
      note.append(noteBody);

      // 缺口：事实核查员的记录板上还缺一格
      const gaps = RHG.gapAnnotation(D.gap);
      gaps.classList.add("state-gaps");
      const gapHead = gaps.querySelector(".gp-gaps-head");
      gapHead.prepend(RHG.avatar("fact-checker", "sm"));

      // 边界与收束：报告收束员
      const boundary = RHG.boundaryLine(D.claim.boundary);
      boundary.classList.add("state-boundary");
      boundary.prepend(RHG.avatar("report-composer", "sm"));

      detail.append(section, note, gaps, boundary);
    });
  }

  window.RHG_VARIANTS.push({ name: "状态", render: render });
})();
