import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});