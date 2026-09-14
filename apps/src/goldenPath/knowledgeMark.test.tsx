/**
 * 证据条目的知识库标记（Part 1 前端）。
 * `provenance === "knowledge"` 的证据条目多一枚「知识库 · YYYY-MM-DD 已核」小标记；
 * 老快照没有这两个字段必须照常渲染，标记也不能挡住点开来源。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildInvestigationSnapshot,
  type InvestigationClaim,
  type InvestigationEvidenceLink,
  type InvestigationSource,
} from "../lib/investigation";
import { ClaimSection } from "./ClaimSection";
import { investigatingUnassessed } from "./fixtures";

afterEach(() => {
  cleanup();
});

const VERIFIED_DAY = "2026-09-11";
const KB_SOURCE: InvestigationSource = {
  id: "src-knowledge-base",
  url: "https://kb.example/leftover-nitrite",
  title: "知识库条目：隔夜菜冷藏与亚硝酸盐",
  excerpt: "冷藏 24 小时内的亚硝酸盐含量远低于致癌剂量",
};

/** 走普通联网检索拿到的那条证据（老数据：没有知识库字段）。 */
const SEARCHED_LINK: InvestigationEvidenceLink = investigatingUnassessed().claims[0]!.evidence[0]!;

/** 服务端注入的知识库证据；传 null 表示是知识库来源却没带 originDate。 */
function knowledgeLink(originDate: string | null = `${VERIFIED_DAY}T03:20:00.000Z`): InvestigationEvidenceLink {
  const link: InvestigationEvidenceLink = {
    sourceId: KB_SOURCE.id,
    role: "support",
    provenance: "knowledge",
  };
  return originDate === null ? link : { ...link, originDate };
}

function renderClaim(evidence: InvestigationEvidenceLink[], onSelectSource = vi.fn()) {
  const snapshot = investigatingUnassessed();
  const claim: InvestigationClaim = { ...snapshot.claims[0]!, evidence };
  render(
    <ClaimSection
      claim={claim}
      index={0}
      sources={[...snapshot.sources, KB_SOURCE]}
      conflicts={[]}
      defaultExpanded
      onSelectSource={onSelectSource}
    />
  );
  return { onSelectSource, claim };
}

function markNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-gp-knowledge-mark]"));
}

describe("知识库来源的证据条目", () => {
  it("带 originDate 的知识库条目出一枚「知识库 · YYYY-MM-DD 已核」，普通条目不出", () => {
    renderClaim([SEARCHED_LINK, knowledgeLink()]);

    const marks = markNodes();
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe(`知识库 · ${VERIFIED_DAY} 已核`);
    expect(marks[0]!.dataset.gpKnowledgeMark).toBe(VERIFIED_DAY);
    // 两条证据都照常出胶囊。
    expect(document.querySelectorAll(".gp-source-container")).toHaveLength(2);
  });

  it("标记与它自己那条证据同一个条目容器，普通证据的 DOM 结构不变", () => {
    renderClaim([SEARCHED_LINK, knowledgeLink()]);

    const knowledgePill = document.querySelector<HTMLElement>(`[data-gp-pill-id="${KB_SOURCE.id}"]`)!;
    const mark = markNodes()[0]!;
    const entry = knowledgePill.closest(".gp-source-container")!.parentElement!;
    expect(entry.contains(mark)).toBe(true);

    // 老数据那条没有多套一层壳：胶囊容器仍是胶囊行的直接子节点。
    const searchedPill = document.querySelector<HTMLElement>(
      `[data-gp-pill-id="${SEARCHED_LINK.sourceId}"]`
    )!;
    expect(searchedPill.closest(".gp-source-container")!.parentElement!.classList.contains("gp-sources-pills-row")).toBe(true);
  });

  it("老快照没有这两个字段：照常渲染、无标记、无多余容器", () => {
    renderClaim([SEARCHED_LINK, { sourceId: KB_SOURCE.id, role: "support" }]);

    expect(markNodes()).toHaveLength(0);
    expect(document.querySelectorAll(".gp-source-container")).toHaveLength(2);
    expect(document.querySelectorAll(".gp-sources-pills-row > span")).toHaveLength(0);
  });

  it("provenance 不是 knowledge 的条目不标记（不是「有 provenance 就算」）", () => {
    const other = {
      sourceId: KB_SOURCE.id,
      role: "support",
      provenance: "search",
      originDate: `${VERIFIED_DAY}T03:20:00.000Z`,
    } as unknown as InvestigationEvidenceLink;
    renderClaim([other]);

    expect(markNodes()).toHaveLength(0);
  });

  it("是知识库来源但没带 originDate：标记照出，只是不写日期", () => {
    renderClaim([knowledgeLink(null)]);

    const marks = markNodes();
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("知识库 · 已核");
    expect(marks[0]!.dataset.gpKnowledgeMark).toBe("");
  });

  it("带标记的胶囊照常点开来源", () => {
    const { onSelectSource, claim } = renderClaim([SEARCHED_LINK, knowledgeLink()]);

    const knowledgePill = document.querySelector<HTMLElement>(`[data-gp-pill-id="${KB_SOURCE.id}"]`)!;
    fireEvent.click(knowledgePill);

    expect(onSelectSource).toHaveBeenCalledTimes(1);
    expect(onSelectSource.mock.calls[0]![0].sourceId).toBe(KB_SOURCE.id);
    expect(onSelectSource.mock.calls[0]![2]).toBe(claim.id);
  });

  it("服务端构建器透传的 provenance/originDate 能直接渲染出标记（两侧字段名对齐）", () => {
    const atom = "隔夜菜的亚硝酸盐含量会超标";
    const kbUrl = "https://kb.example/nitrite";
    const snapshot = buildInvestigationSnapshot(
      {
        originalClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
        phase: "complete",
        claimAtoms: [atom],
        claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
        atomSearchBundle: {
          atomsSearched: [atom],
          byAtomKey: {
            [atom]: [
              {
                url: kbUrl,
                title: "知识库条目：隔夜菜亚硝酸盐",
                snippet: "冷藏 24 小时内的含量远低于限值",
                provenance: "knowledge",
                originDate: VERIFIED_DAY,
              },
            ],
          },
        },
        subclaimVerdicts: [
          {
            claimAtom: atom,
            verdict: "false",
            evidence: "材料显示远低于限值。",
            boundary: "",
            supportingSources: [],
            contradictingSources: [{ url: kbUrl, title: "知识库条目：隔夜菜亚硝酸盐", snippet: "远低于限值" }],
            evidenceGaps: [],
          },
        ],
        report: { conclusion: "超标说法不成立。", verdictType: "false" },
      },
      { claimAtomKeyFn: (text) => text.trim() }
    );
    const claim = snapshot.claims[0]!;
    expect(claim.evidence.some((link) => link.provenance === "knowledge")).toBe(true);

    render(
      <ClaimSection
        claim={claim}
        index={0}
        sources={snapshot.sources}
        conflicts={snapshot.conflicts}
        defaultExpanded
        onSelectSource={vi.fn()}
      />
    );

    const marks = markNodes();
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe(`知识库 · ${VERIFIED_DAY} 已核`);
  });
});

describe("同一案上一轮来源的证据条目", () => {
  it("出一枚「依据来自刚才那一轮」，胶囊仍可点开来源", () => {
    const { onSelectSource } = renderClaim([
      SEARCHED_LINK,
      { sourceId: KB_SOURCE.id, role: "support", provenance: "prior-round", originDate: VERIFIED_DAY },
    ]);

    const marks = markNodes();
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("依据来自刚才那一轮");
    expect(marks[0]!.dataset.gpPriorRoundMark).toBe("true");
    expect(document.querySelectorAll(".gp-source-container")).toHaveLength(2);

    fireEvent.click(document.querySelector<HTMLElement>(`[data-gp-pill-id="${KB_SOURCE.id}"]`)!);
    expect(onSelectSource).toHaveBeenCalledTimes(1);
  });
});
