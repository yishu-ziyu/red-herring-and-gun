/*
 * 第三轮 · 对质
 * 最强：两位调查员一人读一边，站在「片段」的两栏顶上。
 * 风险已标：角色站到材料两边，可能被读成“两个人在吵架”而不是“两组材料对不上”。
 */
(function () {
  const D = window.RHG_DATA;
  const RHG = window.RHG;
  const h = RHG.h;

  const READER = {
    support: "fact-checker",
    contradict: "source-validator",
  };

  function render() {
    RHG.mountStage(function (detail) {
      const section = h("section", "snip-cols duel-cols");

      function side(def) {
        const col = h("div", "snip-side is-" + def.position);
        const reader = h("div", "duel-reader");
        reader.append(RHG.avatar(READER[def.position], "lg"));
        const sideHead = h("header", "snip-side-head");
        sideHead.append(
          h("span", "gp-role-glyph is-" + def.position, "●"),
          h("h4", null, def.label),
          h("span", "seam-side-count", def.sourceIds.length + " 条")
        );
        reader.append(sideHead);
        col.append(reader);

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

      const note = h("p", "v1-seam-note");
      note.append(h("strong", null, "争点在哪："), D.conflict.reason);

      detail.append(section, note, RHG.gapAnnotation(D.gap), RHG.boundaryLine(D.claim.boundary));
    });
  }

  window.RHG_VARIANTS.push({ name: "对质", render: render });
})();
