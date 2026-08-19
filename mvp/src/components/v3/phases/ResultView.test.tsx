import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryCandidate } from "../../../lib/agentRuntime/memoryCandidateTypes";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import { ResultView } from "./ResultView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const THIS_CLAIM = "隔夜菜会致癌，吃了等于吃毒药";

function makeCandidate(partial: {
  id: string;
  claim: string;
  status?: MemoryCandidate["status"];
  title?: string;
}): MemoryCandidate {
  return {
    id: partial.id,
    kind: "case_pattern",
    status: partial.status ?? "proposed",
    title: partial.title ?? `候选 ${partial.id}`,
    summary: "下次遇到相似命题，先复用这个结论边界。",
    confidence: 80,
    tags: ["case"],
    proposedByAgent: "ReportComposer",
    payload: {},
    provenance: {
      runId: `run-${partial.id}`,
      claim: partial.claim,
      normalizedClaim: partial.claim,
      createdAt: Date.now(),
      sourceUrls: [],
      unresolvedQuestions: [],
    },
  };
}

async function seedMemoryCandidates(candidates: MemoryCandidate[]) {
  const knowledgeBase = createKnowledgeBase();
  for (const candidate of candidates) {
    await knowledgeBase.saveMemoryCandidate(candidate);
  }
}

function stubSetStatusApi() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      action?: string;
      id?: string;
      status?: MemoryCandidate["status"];
    };
    const listed = await createKnowledgeBase().listMemoryCandidates();
    const current = listed.find((candidate) => candidate.id === body.id);
    const updated: MemoryCandidate = {
      ...(current ?? makeCandidate({ id: body.id ?? "unknown", claim: THIS_CLAIM })),
      status: body.status ?? "proposed",
      statusUpdatedAt: Date.now(),
    };
    return {
      ok: true,
      json: async () => ({ candidate: updated }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function readPostBody(fetchMock: ReturnType<typeof stubSetStatusApi>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as {
    action?: string;
    id?: string;
    status?: string;
  };
}

const SAMPLE_REPORT: Record<string, unknown> = {
  verdictType: "false",
  credibilityLabel: "谣言",
  credibilityScore: 92,
  conclusion: "该说法没有可靠证据支持，属于不实信息。",
  recommendation: "不能信。",
  subclaimVerdicts: [
    {
      claimAtom: "隔夜菜会致癌",
      verdict: "false",
      evidence: "未见权威卫生机构支持该绝对化表述[1]。",
      boundary: "不能推出所有剩菜都有毒。",
      supportingSources: [
        {
          title: "WHO 食品安全",
          url: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
          snippet: "食品安全要点摘要",
        },
      ],
      contradictingSources: [],
      evidenceGaps: [],
    },
  ],
};

describe("ResultView", () => {
  it("renders formal verdict text from finalReport", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const report = screen.getByLabelText("最终核查判断");
    expect(report.querySelector(".mission-final-conclusion > span")).toHaveTextContent("结论");
    expect(report).not.toHaveTextContent("一句话结论");
    expect(report).toHaveTextContent(/该说法没有可靠证据支持/);
    expect(report).toHaveTextContent(/不能信|谣言|92/);
    expect(screen.getByLabelText("能不能信")).toHaveTextContent("不能信。");
  });

  it("shows reverify button and invokes callback", () => {
    const onReverify = vi.fn();
    render(
      <ResultView
        claim="测试说法"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={onReverify}
      />
    );

    const button = screen.getByRole("button", { name: "重新核查" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onReverify).toHaveBeenCalledTimes(1);
  });

  it("renders numbered citation footer from supportingSources under conclusion and claim detail", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    // Top conclusion aggregates unique supporting sources as numbered footer.
    expect(screen.getAllByText("WHO 食品安全").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("who.int").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("note")).toHaveTextContent(/句内编号对应下方来源/);

    // Expand claim detail: evidence markers become linked chips bound to source 1.
    fireEvent.click(screen.getByRole("button", { name: /隔夜菜会致癌/ }));
    const chipLinks = screen.getAllByRole("link", { name: /来源 1/ });
    expect(chipLinks.length).toBeGreaterThanOrEqual(1);
    expect(chipLinks[0]).toHaveAttribute(
      "href",
      "https://www.who.int/news-room/fact-sheets/detail/food-safety"
    );
    // Open snippet from claim-detail footer (may also appear under conclusion).
    const toggles = screen.getAllByRole("button", { name: "查看摘要" });
    fireEvent.click(toggles[toggles.length - 1]);
    expect(screen.getByText("食品安全要点摘要")).toBeInTheDocument();
  });

  it("process footprint expands with claim → atoms → sources → verdict summary", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /核查足迹/ }));
    const footprint = screen.getByLabelText("本页可核对的核查足迹");
    expect(footprint).toHaveTextContent("隔夜菜会致癌");
    expect(footprint).toHaveTextContent(/1 条/);
    expect(footprint).toHaveTextContent(/已绑定来源|支撑来源/);
  });

  it("process footprint lists evidence pursuit hops when present", () => {
    render(
      <ResultView
        claim="某地明天发生7级地震"
        finalReport={{
          ...SAMPLE_REPORT,
          evidencePursuit: {
            hops: [
              {
                hop: 1,
                goal: "找原始发布",
                query: "某地明天发生7级地震 官方通报",
                resultKind: "primary",
                resultKindLabel: "原始来源",
                missingAfter: ["反证"],
              },
            ],
          },
        }}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /核查足迹/ }));
    const footprint = screen.getByLabelText("本页可核对的核查足迹");
    expect(footprint).toHaveTextContent("证据追索");
    expect(footprint).toHaveTextContent("找原始发布");
    expect(footprint).toHaveTextContent("原始来源");
  });

  it("renders interrupted judgment without padded composer copy", () => {
    render(
      <ResultView
        claim="房屋养老金要从工资里扣"
        finalReport={{
          verdictType: "unverified",
          credibilityLabel: "未能判断",
          credibilityScore: 30,
          conclusion: "本次核查未能完成最终判断：模型服务暂时不可用。",
          recommendation: "请稍后重试，或检查模型配置后重新发起核查。",
          citationSources: [{ title: "央行公开说明", url: "https://example.com/pboc" }],
          evidenceChain: [
            {
              layer: "证据",
              finding: "审核器补全：前序输出未提供完整证据链",
              evidence: "（审稿补全，非新增外部事实）",
              sourceRefs: [],
            },
          ],
          _source: "error-boundary",
        }}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const report = screen.getByLabelText("最终核查判断");
    expect(within(report).getByText("这次没查完")).toBeInTheDocument();
    expect(within(report).getByRole("button", { name: "再查一次" })).toBeInTheDocument();
    expect(within(report).getByRole("link", { name: "央行公开说明" })).toHaveAttribute(
      "href",
      "https://example.com/pboc"
    );
    expect(within(report).queryByText(/审核器补全/)).not.toBeInTheDocument();
    expect(within(report).queryByText(/模型服务暂时不可用/)).not.toBeInTheDocument();
  });

  it("dossier variant drops page chrome and process footprint", () => {
    render(
      <ResultView
        variant="dossier"
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    expect(screen.queryByText("返回")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /核查足迹/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新核查" })).toBeInTheDocument();
    expect(screen.getByLabelText("最终核查判断")).toHaveTextContent(/该说法没有可靠证据支持/);
  });

  it("dossier shows write/ignore for this claim's proposed candidate below the verdict", async () => {
    await seedMemoryCandidates([
      makeCandidate({ id: "cand-this", claim: THIS_CLAIM, title: "本案可复用边界" }),
    ]);

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const writeButton = await screen.findByRole("button", { name: "写入知识库" });
    const ignoreButton = screen.getByRole("button", { name: "忽略" });
    const verdict = screen.getByLabelText("能不能信");
    const panel = screen.getByLabelText("知识库候选");

    expect(writeButton).toBeInTheDocument();
    expect(ignoreButton).toBeInTheDocument();
    expect(verdict).toHaveTextContent("不能信。");
    expect(verdict.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(panel).toHaveTextContent("本案可复用边界");
    expect(panel).not.toHaveTextContent("Agent");
  });

  it("accepting a proposed candidate POSTs setStatus accepted and lists it in accepted", async () => {
    await seedMemoryCandidates([makeCandidate({ id: "cand-accept", claim: THIS_CLAIM })]);
    const fetchMock = stubSetStatusApi();

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "写入知识库" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/agent/memory-candidates");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(readPostBody(fetchMock)).toMatchObject({
      action: "setStatus",
      id: "cand-accept",
      status: "accepted",
    });

    await waitFor(async () => {
      const accepted = await createKnowledgeBase().listMemoryCandidates({ status: "accepted" });
      expect(accepted.some((candidate) => candidate.id === "cand-accept")).toBe(true);
    });
    expect(await screen.findByText("已确认复用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "写入知识库" })).not.toBeInTheDocument();
  });

  it("ignoring a proposed candidate POSTs rejected and keeps it out of accepted", async () => {
    await seedMemoryCandidates([makeCandidate({ id: "cand-ignore", claim: THIS_CLAIM })]);
    const fetchMock = stubSetStatusApi();

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "忽略" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(readPostBody(fetchMock)).toMatchObject({
      action: "setStatus",
      id: "cand-ignore",
      status: "rejected",
    });

    await waitFor(async () => {
      const accepted = await createKnowledgeBase().listMemoryCandidates({ status: "accepted" });
      expect(accepted.some((candidate) => candidate.id === "cand-ignore")).toBe(false);
    });
    expect(await screen.findByText("已忽略")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "忽略" })).not.toBeInTheDocument();
  });

  it("does not put unconfirmed proposed candidates into accepted", async () => {
    await seedMemoryCandidates([makeCandidate({ id: "cand-proposed", claim: THIS_CLAIM })]);

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    expect(await screen.findByRole("button", { name: "写入知识库" })).toBeInTheDocument();
    const accepted = await createKnowledgeBase().listMemoryCandidates({ status: "accepted" });
    expect(accepted.some((candidate) => candidate.id === "cand-proposed")).toBe(false);
  });

  it("interrupted dossier does not show write-to-knowledge-base", async () => {
    await seedMemoryCandidates([makeCandidate({ id: "cand-interrupted", claim: THIS_CLAIM })]);

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={{
          verdictType: "unverified",
          credibilityLabel: "未能判断",
          credibilityScore: 30,
          conclusion: "本次核查未能完成最终判断：模型服务暂时不可用。",
          recommendation: "请稍后重试，或检查模型配置后重新发起核查。",
          _source: "error-boundary",
        }}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    expect(screen.getByText("这次没查完")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "写入知识库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "忽略" })).not.toBeInTheDocument();
  });

  it("does not show other claims' candidates on this dossier page", async () => {
    await seedMemoryCandidates([
      makeCandidate({ id: "cand-this", claim: THIS_CLAIM, title: "本案搜索策略" }),
      makeCandidate({
        id: "cand-other",
        claim: "房屋养老金要从工资里扣",
        title: "他案失败记录",
      }),
    ]);

    render(
      <ResultView
        variant="dossier"
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const panel = await screen.findByLabelText("知识库候选");
    expect(panel).toHaveTextContent("本案搜索策略");
    expect(panel).not.toHaveTextContent("他案失败记录");
    expect(screen.queryByText("他案失败记录")).not.toBeInTheDocument();
  });

  it("page variant does not mount the knowledge candidate panel", async () => {
    await seedMemoryCandidates([makeCandidate({ id: "cand-page", claim: THIS_CLAIM })]);

    render(
      <ResultView
        claim={THIS_CLAIM}
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    expect(screen.getByLabelText("能不能信")).toHaveTextContent("不能信。");
    expect(screen.queryByRole("button", { name: "写入知识库" })).not.toBeInTheDocument();
  });

  it("claimItems 按原句序，立场型夹在中间，未检索条是还查不清", () => {
    render(
      <ResultView
        claim="背景一。立场。隔夜菜导致癌症。"
        finalReport={{
          verdictType: "unverified",
          faceVerdict: "还查不清",
          conclusion: "有一截还没查到。",
          claimItems: [
            {
              text: "背景一",
              verifiable: true,
              type: "fact",
              verdict: { claimAtom: "背景一", verdict: "unverified", evidenceGaps: ["检索预算未覆盖"] },
            },
            { text: "不该吃隔夜菜", verifiable: false, type: "value" },
            {
              text: "隔夜菜导致癌症",
              verifiable: true,
              type: "causal",
              verdict: {
                claimAtom: "隔夜菜导致癌症",
                verdict: "false",
                evidence: "反证[1]。",
                contradictingSources: [
                  { title: "辟谣", url: "https://piyao.example/1", snippet: "不实" },
                ],
              },
            },
          ],
        }}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const list = screen.getByLabelText("命题核查清单");
    expect(list).toHaveTextContent("3 项");
    expect(list).toHaveTextContent("背景一");
    expect(list).toHaveTextContent("不该吃隔夜菜");
    expect(list).toHaveTextContent("隔夜菜导致癌症");
    expect(within(list).getByText("立场型")).toBeInTheDocument();
    expect(within(list).getByText("不适用真/假判断")).toBeInTheDocument();
    expect(within(list).getByText("还查不清")).toBeInTheDocument();
    expect(screen.getByLabelText("最终核查判断")).toHaveTextContent("还查不清");

    fireEvent.click(screen.getByRole("button", { name: /隔夜菜导致癌症/ }));
    expect(screen.getByRole("link", { name: /来源 1/ })).toHaveAttribute("href", "https://piyao.example/1");
  });
});
