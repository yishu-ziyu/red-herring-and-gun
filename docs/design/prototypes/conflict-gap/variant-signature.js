/*
 * 第三轮 · 署名
 * 强度最轻：角色只做这次调查的视觉身份——页眉一位、页尾一位。
 * 冲突与缺口仍是「片段」版式，不加装饰。
 */
(function () {
  const D = window.RHG_DATA;
  const RHG = window.RHG;
  const h = RHG.h;

  function render() {
    RHG.mountStage(function (detail) {
      // 页眉：调查员的身份，站在“你调查的说法”旁边
      const head = document.querySelector(".doc-head");
      const kicker = head.querySelector(".doc-kicker");
      kicker.classList.add("sig-kicker");
      kicker.prepend(RHG.avatar("rumor-detector", "md"));

      // 片段版式的两栏与争点
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

      const note = h("p", "v1-seam-note");
      note.append(h("strong", null, "争点在哪："), D.conflict.reason);

      detail.append(section, note, RHG.gapAnnotation(D.gap), RHG.boundaryLine(D.claim.boundary));

      // 页尾：把这次调查的结尾状态说清，并由调查员签字
      const doc = detail.closest(".doc");
      const foot = h("footer", "sig-foot");
      foot.append(RHG.avatar("rumor-detector", "lg"));
      const footBody = h("div", "sig-foot-body");
      footBody.append(
        h("strong", null, "这次调查到此为止。"),
        h("span", null, "尚缺 1 项：" + D.gap.description + "。它对判断的影响见上。")
      );
      foot.append(footBody);
      doc.append(foot);
    });
  }

  window.RHG_VARIANTS.push({ name: "署名", render: render });
})();
