import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "../../../../lib/missionShell";
import {
  FIXTURE_AGENT_THOUGHT,
  FIXTURE_COMPLETE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_LOOP_PROGRESSIVE,
} from "../../../../lib/missionShell/fixtures";
import { mapShellToApodexRun } from "./apodexRunMap";

const FED = /美联储|Federal Reserve|FOMC|dot plot/i;

describe("mapShellToApodexRun", () => {
  it("todo_write result becomes the live board instead of the pipeline checklist", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(
        [
          {
            type: "agent_start",
            agent: "investigator",
            agentName: "核查",
            timestamp: 1,
          },
          {
            type: "tool_result",
            toolId: "todo_write",
            toolName: "todo_write",
            query: "任务板",
            result: {
              todos: [
                { id: "1", label: "拆开要核对的部分", status: "done" },
                { id: "2", label: "打开官方通报", status: "active" },
              ],
            },
            timestamp: 2,
          },
        ],
        { claim: "高铁车厢的辐射会让乘客不孕" }
      )
    );
    expect(run.board.map((t) => t.label)).toEqual(["拆开要核对的部分", "打开官方通报"]);
    expect(run.board.map((t) => t.status)).toEqual(["done", "active"]);
    expect(run.board.some((t) => t.id === "plan")).toBe(false);
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("empty live stream: board is visible with first step active, no Fed replay", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell([], { claim: "高铁车厢的辐射会让乘客不孕" })
    );
    expect(run.live).toBe(true);
    expect(run.boardVisible).toBe(true);
    expect(run.steps.some((s) => s.kind === "board")).toBe(true);
    expect(run.board[0]?.status).toBe("active");
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("FIXTURE_EARLY: live thought + board, no report, no Fed replay", () => {
    const run = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_EARLY));
    expect(run.claim).toContain("隔夜菜");
    expect(run.live).toBe(true);
    expect(run.report).toBeUndefined();
    expect(run.steps.some((s) => s.kind === "thought")).toBe(true);
    expect(run.steps.some((s) => s.kind === "board")).toBe(true);
    expect(run.boardVisible).toBe(true);
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("FIXTURE_AGENT_THOUGHT: streams real reasoning into one thinking ticker", () => {
    const run = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_AGENT_THOUGHT));
    const thoughts = run.steps.filter((s) => s.kind === "thought");
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]?.ticker).toBe(true);
    expect(thoughts[0]?.label).toBe("thinking…");
    expect(thoughts[0]?.paragraphs?.join("")).toContain("真实思考句一");
    expect(thoughts[0]?.paragraphs?.join("")).toContain("真实思考句三");
    expect(thoughts[0]?.status).toBe("loading");
  });

  it("FIXTURE_MID: Search web keeps sources inside the card, no fake Visit dump", () => {
    const run = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_MID));
    const search = run.steps.find((s) => s.kind === "search");
    expect(search?.query).toContain("隔夜菜");
    expect(search?.sites?.some((s) => s.href?.includes("who.int"))).toBe(true);
    expect(run.steps.filter((s) => s.kind === "visit")).toHaveLength(0);
    const emptyThoughts = run.steps.filter(
      (s) => s.kind === "thought" && !(s.paragraphs && s.paragraphs.length) && s.status !== "loading"
    );
    expect(emptyThoughts.length).toBeLessThanOrEqual(1);
    expect(run.report).toBeUndefined();
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("FIXTURE_COMPLETE: 核心结论 answers the claim, not a four-word stamp", () => {
    const run = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_COMPLETE));
    expect(run.live).toBe(false);
    expect(run.report?.verdictLabel).toBe("有真有假");
    expect(run.report?.conclusion).toContain("致癌");
    expect(run.report?.memo).toContain("## 核心结论");
    expect(run.report?.memo).toContain("说法存在夸大");
    expect(run.report?.memo).not.toMatch(/## 核心结论\s+\*\*有真有假/);
    expect(run.report?.memo).toContain("REFERENCES");
    expect(run.report?.sources.some((s) => s.url?.includes("example.com"))).toBe(true);
    expect(run.board.every((t) => t.status === "done")).toBe(true);
    expect(`${run.board.filter((t) => t.status === "done").length}/${run.board.length}`).toMatch(/^\d+\/\d+$/);
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("empty loading thoughts collapse to one thinking ticker", () => {
    const early = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_EARLY));
    const tickers = early.steps.filter((s) => s.kind === "thought" && s.ticker);
    expect(tickers.length).toBeLessThanOrEqual(1);
    const done = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_COMPLETE));
    expect(done.steps.filter((s) => s.kind === "visit")).toHaveLength(0);
    expect(done.steps.filter((s) => s.kind === "thought" && s.ticker)).toHaveLength(0);
    const thoughts = done.steps.filter((s) => s.kind === "thought");
    expect(thoughts.length).toBeLessThanOrEqual(3);
    expect(thoughts.every((t) => t.label === "Thought deeply")).toBe(true);
  });

  it("incomplete fallback report is 还查不清, not 不能信", () => {
    const base = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const run = mapShellToApodexRun({
      ...base,
      verdict: {
        present: true,
        verdictType: "false",
        conclusion: "不能信。还查不清。该说法目前还查不清。",
        shareAdvice: "还查不清。先把出处补上，再判断能不能信。",
        keyFindings: ["核查模型未完成，结论只能依据检索到的公开材料。", "信源审计模型未完成"],
        topSources: [],
      },
    });
    expect(run.report?.verdictLabel).toBe("还查不清");
    expect(run.report?.tone).toBe("unverified");
    expect(run.report?.conclusion).not.toMatch(/^不能信/);
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("finished report marks the task board done, not 0/6 leftover pending", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(
        [
          {
            type: "tool_result",
            toolId: "todo_write",
            toolName: "todo_write",
            query: "任务板",
            result: {
              todos: [
                { id: "1", label: "拆开要核对的部分", status: "pending" },
                { id: "2", label: "打开官方通报", status: "active" },
              ],
            },
            timestamp: 1,
          },
          {
            type: "complete",
            claim: "隔夜菜加热会致癌吗",
            finalReport: {
              verdictType: "false",
              conclusion: "不能信。公开材料不支持整句致癌。",
              citationSources: [{ title: "示例", url: "https://example.com/food-safety" }],
            },
            timestamp: 2,
          },
        ],
        { claim: "隔夜菜加热会致癌吗" }
      )
    );
    expect(run.live).toBe(false);
    expect(run.board.map((t) => t.status)).toEqual(["done", "done"]);
    expect(run.report?.verdictLabel).toBe("不能信");
  });

  it("loop before todo_write does not dump the pipeline six-item board", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(FIXTURE_LOOP_PROGRESSIVE.slice(0, 1), {
        claim: "隔夜菜加热会致癌吗",
      })
    );
    expect(run.board.map((t) => t.label).join(" ")).not.toMatch(/确认核查问题|对照公开材料|看来源能不能站住/);
    expect(run.board.length).toBeLessThanOrEqual(1);
  });

  it("loop stream interleaves Thought deeply between Search and Visit", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(FIXTURE_LOOP_PROGRESSIVE, { claim: "隔夜菜加热会致癌吗" })
    );
    expect(run.steps.map((s) => s.kind)).toEqual([
      "thought",
      "board",
      "thought",
      "search",
      "thought",
      "visit",
      "thought",
      "visit",
    ]);
    const thoughts = run.steps.filter((s) => s.kind === "thought");
    expect(thoughts.every((t) => t.label === "Thought deeply")).toBe(true);
    expect(thoughts.every((t) => t.ticker !== true)).toBe(true);
    expect(run.steps.filter((s) => s.kind === "search")).toHaveLength(1);
    expect(run.steps.filter((s) => s.kind === "visit")).toHaveLength(2);
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("consecutive Visit page tools merge into one card with · urls", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(
        [
          {
            type: "tool_result",
            toolId: "web_fetch",
            toolName: "web_fetch",
            query: "https://example.com/a",
            result: { url: "https://example.com/a", title: "A" },
            timestamp: 1,
          },
          {
            type: "tool_result",
            toolId: "web_fetch",
            toolName: "web_fetch",
            query: "https://example.com/b",
            result: { url: "https://example.com/b", title: "B" },
            timestamp: 2,
          },
        ],
        { claim: "隔夜菜加热会致癌吗" }
      )
    );
    const visits = run.steps.filter((s) => s.kind === "visit");
    expect(visits).toHaveLength(1);
    expect(visits[0]?.visit?.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(visits[0]?.detail).toContain("example.com");
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("FIXTURE_ERROR: interrupted report, live false", () => {
    const run = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_ERROR));
    expect(run.live).toBe(false);
    expect(run.errorMessage).toBeTruthy();
    expect(run.report?.tone).toBe("interrupted");
    expect(run.report?.verdictLabel).toBe("这次没查完");
    expect(JSON.stringify(run)).not.toMatch(FED);
  });

  it("error-boundary complete is 这次没查完, not 还查不清, and keeps citation sources", () => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell([
        {
          type: "complete",
          totalLatencyMs: 900,
          steps: [],
          finalReport: {
            _source: "error-boundary",
            verdictType: "unverified",
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
          },
        },
      ])
    );
    expect(run.report?.verdictLabel).toBe("这次没查完");
    expect(run.report?.tone).toBe("interrupted");
    expect(run.report?.conclusion).toBeUndefined();
    expect(run.report?.findings).toEqual([]);
    expect(run.report?.sources.some((s) => s.url?.includes("example.com/pboc"))).toBe(true);
    expect(JSON.stringify(run)).not.toMatch(/审核器补全|模型服务暂时不可用|检查模型配置/);
  });
});
