import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ReportModal } from "./ReportModal";
import type { DemoCase, FinalReport, SubclaimVerdict } from "../../lib/schemas";

function makeCase(): DemoCase {
  return {
    originalClaim: "测试原句",
    useContext: "测试场景",
    diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
    subclaims: [],
    routes: [],
    searchPlans: [],
    candidates: [],
  };
}

function makeReport(overrides: Partial<FinalReport> = {}): FinalReport {
  return {
    originalClaim: "测试原句",
    overallStatus: "false",
    allowedConclusion: "",
    claimDiagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
    subclaimStatuses: [],
    evidenceChain: [],
    doNotInfer: [],
    rewrittenClaim: { cautious: "谨慎版", publicFacing: "公众版", researchMemo: "" },
    nextEvidenceNeeded: [],
    ...overrides,
  };
}

function renderModal(report: FinalReport) {
  return render(
    <ReportModal isOpen onClose={vi.fn()} report={report} caseData={makeCase()} />,
  );
}

describe("ReportModal 逐命题定罪区块", () => {
  afterEach(() => {
    cleanup();
  });

  it("subclaimVerdicts 缺失时渲染空态提示，不显示任何条目", () => {
    renderModal(makeReport());
    expect(screen.getByText("逐命题定罪")).toBeInTheDocument();
    expect(screen.getByText("本次未生成逐命题判定")).toBeInTheDocument();
    expect(document.querySelector(".report-verdict-item")).toBeNull();
  });

  it("subclaimVerdicts 为空数组时渲染空态提示", () => {
    renderModal(makeReport({ subclaimVerdicts: [] }));
    expect(screen.getByText("本次未生成逐命题判定")).toBeInTheDocument();
  });

  it("单条 item 渲染 claimAtom / evidence / boundary", () => {
    const verdicts: SubclaimVerdict[] = [
      {
        claimAtom: "隔夜菜会致癌",
        verdict: "false",
        evidence: "未检索到支持该致癌结论的可靠证据",
        boundary: "仅针对常温隔夜存放场景",
      },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));

    expect(screen.getByText("隔夜菜会致癌")).toBeInTheDocument();
    expect(screen.getByText("未检索到支持该致癌结论的可靠证据")).toBeInTheDocument();
    expect(screen.getByText("仅针对常温隔夜存放场景")).toBeInTheDocument();
    expect(screen.queryByText("本次未生成逐命题判定")).not.toBeInTheDocument();
  });

  it("verdict 五值分别渲染对应标签与着色 class", () => {
    const verdicts: SubclaimVerdict[] = [
      { claimAtom: "a", verdict: "true", evidence: "", boundary: "" },
      { claimAtom: "b", verdict: "false", evidence: "", boundary: "" },
      { claimAtom: "c", verdict: "partial", evidence: "", boundary: "" },
      { claimAtom: "d", verdict: "exaggerated", evidence: "", boundary: "" },
      { claimAtom: "e", verdict: "unverified", evidence: "", boundary: "" },
    ];
    const { container } = renderModal(makeReport({ subclaimVerdicts: verdicts }));

    const badges = container.querySelectorAll<HTMLElement>(".verdict-badge");
    expect(badges).toHaveLength(5);
    expect(badges[0].className).toContain("verdict-true");
    expect(badges[0].textContent).toBe("属实");
    expect(badges[1].className).toContain("verdict-false");
    expect(badges[1].textContent).toBe("不实");
    expect(badges[2].className).toContain("verdict-partial");
    expect(badges[2].textContent).toBe("部分属实");
    expect(badges[3].className).toContain("verdict-exaggerated");
    expect(badges[3].textContent).toBe("夸大");
    expect(badges[4].className).toContain("verdict-unverified");
    expect(badges[4].textContent).toBe("未判定·待补证");
  });

  it("unverified 明确标注待补证而非伪装成定罪", () => {
    const verdicts: SubclaimVerdict[] = [
      { claimAtom: "a", verdict: "unverified", evidence: "", boundary: "模型未覆盖，待补证" },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));
    expect(screen.getByText("未判定·待补证")).toBeInTheDocument();
    expect(screen.getByText("模型未覆盖，待补证")).toBeInTheDocument();
  });

  it("默认收起：分区不渲染，aria-expanded 为 false", () => {
    const verdicts: SubclaimVerdict[] = [
      {
        claimAtom: "隔夜菜会致癌",
        verdict: "false",
        evidence: "",
        boundary: "",
        supportingSources: [{ url: "https://a.com", title: "来源A", snippet: "摘要" }],
        contradictingSources: [{ url: "https://b.com", title: "来源B", snippet: "摘要" }],
        evidenceGaps: ["缺口一"],
      },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));

    expect(screen.queryByText("支撑证据")).not.toBeInTheDocument();
    expect(screen.queryByText("反证 / 质疑")).not.toBeInTheDocument();
    expect(screen.queryByText("证据缺口")).not.toBeInTheDocument();
    const header = screen.getByRole("button", { name: /隔夜菜会致癌/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("点击展开渲染三区，再次点击折叠收起", () => {
    const verdicts: SubclaimVerdict[] = [
      {
        claimAtom: "隔夜菜会致癌",
        verdict: "false",
        evidence: "",
        boundary: "",
        supportingSources: [{ url: "https://a.com", title: "来源A", snippet: "摘要A" }],
        contradictingSources: [{ url: "https://b.com", title: "来源B", snippet: "摘要B" }],
        evidenceGaps: ["缺口一", "缺口二"],
      },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));

    const header = screen.getByRole("button", { name: /隔夜菜会致癌/ });
    fireEvent.click(header);
    expect(screen.getByText("支撑证据")).toBeInTheDocument();
    expect(screen.getByText("反证 / 质疑")).toBeInTheDocument();
    expect(screen.getByText("证据缺口")).toBeInTheDocument();
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(header);
    expect(screen.queryByText("支撑证据")).not.toBeInTheDocument();
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("支撑来源与反证来源链接正确（target=_blank 且 href 指向源 url）", () => {
    const verdicts: SubclaimVerdict[] = [
      {
        claimAtom: "隔夜菜会致癌",
        verdict: "false",
        evidence: "",
        boundary: "",
        supportingSources: [{ url: "https://support.example.com/a", title: "支撑来源", snippet: "摘要" }],
        contradictingSources: [{ url: "https://contradict.example.com/b", title: "反证来源", snippet: "摘要" }],
      },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));

    fireEvent.click(screen.getByRole("button", { name: /隔夜菜会致癌/ }));

    const supportLink = screen.getByRole("link", { name: "支撑来源" });
    expect(supportLink.getAttribute("href")).toBe("https://support.example.com/a");
    expect(supportLink.getAttribute("target")).toBe("_blank");

    const contradictLink = screen.getByRole("link", { name: "反证来源" });
    expect(contradictLink.getAttribute("href")).toBe("https://contradict.example.com/b");
    expect(contradictLink.getAttribute("target")).toBe("_blank");
  });

  it("空分区隐藏：仅有支撑来源时不渲染反证/缺口标题", () => {
    const verdicts: SubclaimVerdict[] = [
      {
        claimAtom: "隔夜菜会致癌",
        verdict: "false",
        evidence: "",
        boundary: "",
        supportingSources: [{ url: "https://a.com", title: "来源A", snippet: "摘要" }],
      },
    ];
    renderModal(makeReport({ subclaimVerdicts: verdicts }));

    fireEvent.click(screen.getByRole("button", { name: /隔夜菜会致癌/ }));
    expect(screen.getByText("支撑证据")).toBeInTheDocument();
    expect(screen.queryByText("反证 / 质疑")).not.toBeInTheDocument();
    expect(screen.queryByText("证据缺口")).not.toBeInTheDocument();
  });
});