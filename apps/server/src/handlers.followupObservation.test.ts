/**
 * 追问观测端到端干跑（契约 docs/evals/2026-09-12-followup-observation.md Evaluator 4/5）。
 *
 * 管道整段打桩（mock 管道，不烧模型、不出网）：请求仍走完整的 HTTP 处理器——
 * 建 run、跑管线、发 complete、收尾；只把 runCasePipeline 换成确定性 stub。
 * 断言：JSONL 恰增一行、字段与运行身份对得上、不含原句文本；首轮不写记录。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  claim: "隔夜菜里的亚硝酸盐会致癌",
  atomA: "隔夜菜会产生亚硝酸盐",
  atomB: "亚硝酸盐摄入量足以致癌",
  supportUrl: "https://support.test/paper-a",
  report: {} as Record<string, unknown>,
  clearCasesDuringPipeline: false,
  lastFollowUpReuse: undefined as unknown,
}));

vi.mock("./lib/casePipeline/index.js", () => ({
  runCasePipeline: async (input: any) => {
    fixture.lastFollowUpReuse = input.followUpReuse;
    if (fixture.clearCasesDuringPipeline) {
      const caseStore = await import("./lib/caseStore.js");
      caseStore.clearCases();
    }
    const { buildInvestigationSnapshot } = await import("./lib/investigation/index.js");
    input.hooks?.onAtomSearchStart?.(fixture.atomA);
    input.hooks?.onEvidenceLoopRoundStart?.({
      query: "隔夜菜亚硝酸盐 剂量",
      atom: fixture.atomB,
      round: 1,
      goal: "补剂量证据",
      purpose: "补查",
      missingEvidence: ["剂量"],
      trigger: "gap",
    });
    input.hooks?.onInvestigationSnapshot?.(
      buildInvestigationSnapshot(
        {
          originalClaim: fixture.claim,
          phase: "complete",
          claimAtoms: [fixture.atomA, fixture.atomB],
          claimAtomTypes: [fixture.atomA, fixture.atomB].map((text) => ({ text, verifiable: true, type: "fact" })),
          atomSearchBundle: {
            atomsSearched: [fixture.atomA],
            byAtomKey: {
              [fixture.atomA]: [{ url: fixture.supportUrl, title: "支持来源", snippet: "s" }],
            },
          },
          subclaimVerdicts: [
            {
              claimAtom: fixture.atomA,
              verdict: "true",
              evidence: "有一条可点开的来源",
              supportingSources: [{ url: fixture.supportUrl, title: "支持来源", snippet: "s" }],
              contradictingSources: [],
              evidenceGaps: [],
            },
            {
              claimAtom: fixture.atomB,
              verdict: "unverified",
              evidence: "没有剂量数据",
              supportingSources: [],
              contradictingSources: [],
              evidenceGaps: ["缺剂量证据"],
            },
          ],
          report: fixture.report,
        },
        { claimAtomKeyFn: (s: string) => s.trim() }
      )
    );
    return {
      steps: [],
      finalReport: fixture.report,
      atomSearchBundle: {
        atomsSearched: [fixture.atomA],
        byAtomKey: {},
        aggregate: {
          answer: "",
          sources: [],
          relatedQuestions: [],
          model: "",
          traceText: "",
          _source: "stub",
          supportingEvidence: [],
          contradictingEvidence: [],
          unresolvedEvidenceGaps: [],
        },
      },
      search360Result: {},
      memoryCandidates: [],
      runId: "stub-run",
    };
  },
}));

import { createHandlers } from "./handlers.js";
import { hashEmail, requestCode, resetForTests, verifyAndCreate } from "./lib/accountStore.js";
import { encodeSignedJson } from "./lib/aipingAuth.js";
import { EMAIL_SESSION_COOKIE } from "./lib/emailSession.js";
import { clearCases, putCase } from "./lib/caseStore.js";
import { openRunStore } from "./lib/runStore.js";
import { FOLLOW_UP_OBSERVATION_FILE, type FollowUpObservation } from "./lib/followupObservation.js";

const SECRET = "test-server-secret-for-followup-e2e";
const ENV = { OPENAI_API_KEY: "env-key", OPENAI_BASE_URL: "https://api.test/v1" };
const PRIOR_CASE_ID = "prior001";

function observationFile(): string {
  return join(process.env.DATA_DIR || join(process.cwd(), ".data"), FOLLOW_UP_OBSERVATION_FILE);
}

function readObservations(): FollowUpObservation[] {
  if (!existsSync(observationFile())) return [];
  return readFileSync(observationFile(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FollowUpObservation);
}

function mockRes() {
  const events: Record<string, any>[] = [];
  const res: any = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    lastBody: "",
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn((chunk: string) => {
      if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice("data: ".length)));
      return true;
    }),
    end: vi.fn((body?: string) => {
      res.writableEnded = true;
      if (body) res.lastBody = body;
    }),
    on: vi.fn(),
  };
  return { res, events };
}

async function signIn(email: string): Promise<{ hash: string; cookie: string }> {
  const issued = await requestCode(email, SECRET);
  const verified = await verifyAndCreate(email, issued.code!, SECRET);
  const token = encodeSignedJson({ sid: verified.sessionId }, SECRET);
  return { hash: hashEmail(email, SECRET), cookie: `${EMAIL_SESSION_COOKIE}=${token}` };
}

function seedPriorCase(ownerHash: string, verdictType: string, url: string) {
  putCase({
    caseId: PRIOR_CASE_ID,
    claim: fixture.claim,
    report: {
      originalClaim: fixture.claim,
      verdictType,
      conclusion: "上一轮的结论",
      citationSources: [{ url, title: "上一轮来源" }],
    } as never,
    claimReview: {} as never,
    credibilityScore: 40,
    ownerHash,
  });
}

beforeEach(() => {
  process.env.AIPING_SESSION_SECRET = SECRET;
  resetForTests();
  clearCases();
  fixture.clearCasesDuringPipeline = false;
  fixture.lastFollowUpReuse = undefined;
  fixture.report = {};
});

describe("追问 run 的观测记录", () => {
  it("走完整处理器：JSONL 恰增一行、字段齐全、不含原句文本", async () => {
    const owner = await signIn("followup-e2e@test.dev");
    seedPriorCase(owner.hash, "false", "https://prior.test/1");
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    const before = readObservations();

    const handlers = createHandlers({ ...ENV });
    const ticket: any = { kind: "guest", guestId: "e2e-guest", ipKey: null, settled: false };
    const req: any = {
      method: "POST",
      body: {
        claim: `${fixture.claim}（追问：亚硝酸盐要吃多少才危险）`,
        followUp: true,
        caseId: PRIOR_CASE_ID,
        clientRequestId: "req-e2e-followup",
      },
      checkTicket: ticket,
      headers: { cookie: owner.cookie, "x-real-ip": "203.0.113.21" },
      on: vi.fn(),
    };
    const { res, events } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    // 处理器正常收尾：complete 帧 + 响应结束 + 成功才计费
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(ticket.settled).toBe(true);

    const after = readObservations();
    expect(after.length).toBe(before.length + 1);
    const record = after[after.length - 1]!;
    const runStarted = events.find((event) => event.type === "run_started");
    expect(record.runId).toBe(runStarted!.runId);
    // 追问轮是新 case：caseId 另生成一个，上一轮的记在 priorCaseId 上
    expect(record.caseId).toBe(runStarted!.caseId);
    expect(record.caseId).not.toBe(PRIOR_CASE_ID);
    expect(record.priorCaseId).toBe(PRIOR_CASE_ID);

    expect(record.priorVerdict).toBe("false");
    expect(record.verdict).toBe("true");
    expect(record.verdictDelta).toBe("strengthened");
    expect(record.priorSourceCount).toBe(1);
    expect(record.overlapSourceCount).toBe(0);
    expect(record.newSourceCount).toBe(1);
    expect(record.fastPathCandidate).toBe(false);
    // 计数来自真快照与真钩子：2 个命题、1 个真检索过、1 个没定论、2 次检索动作
    expect(record.atomsTotal).toBe(2);
    expect(record.atomsSearched).toBe(1);
    expect(record.atomsUnverified).toBe(1);
    expect(record.searchesTotal).toBe(2);

    // 运行记录也记下了这是追问轮
    const run = openRunStore()!.get(record.runId)!;
    expect(run.isFollowUp).toBe(true);
    expect(run.priorCaseId).toBe(PRIOR_CASE_ID);
    expect(run.caseId).toBe(record.caseId);
    expect(fixture.lastFollowUpReuse).toMatchObject({
      priorClaim: fixture.claim,
      priorReport: expect.objectContaining({ verdictType: "false" }),
    });

    // 隐私：文件里没有原句、没有 URL、没有来源域名
    const raw = readFileSync(observationFile(), "utf8");
    expect(raw).not.toContain(fixture.claim);
    expect(raw).not.toContain("prior.test");
    expect(raw).not.toContain("support.test");
    expect(raw).not.toContain("https://");
  });

  it("判词 same 且没搜到新来源 → fastPathCandidate=true", async () => {
    const owner = await signIn("followup-same@test.dev");
    seedPriorCase(owner.hash, "true", fixture.supportUrl);
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    const before = readObservations();

    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: `${fixture.claim}（追问：再确认一次）`,
        followUp: true,
        caseId: PRIOR_CASE_ID,
        clientRequestId: "req-e2e-candidate",
      },
      checkTicket: { kind: "guest", guestId: "e2e-guest-2", ipKey: null, settled: false },
      headers: { cookie: owner.cookie, "x-real-ip": "203.0.113.22" },
      on: vi.fn(),
    };
    const { res } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    const after = readObservations();
    expect(after.length).toBe(before.length + 1);
    const record = after[after.length - 1]!;
    expect(record.verdictDelta).toBe("same");
    expect(record.priorSourceCount).toBe(1);
    expect(record.overlapSourceCount).toBe(1);
    expect(record.newSourceCount).toBe(0);
    expect(record.fastPathCandidate).toBe(true);
  });

  it("上一轮报告读不到 → 不写记录，也不阻断 run", async () => {
    const owner = await signIn("followup-gone@test.dev");
    seedPriorCase(owner.hash, "false", "https://prior.test/1");
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    // 管线跑到一半时上一轮案件没了（被删 / 存储故障）：观测跳过，run 照常完成
    fixture.clearCasesDuringPipeline = true;
    const before = readObservations();

    const handlers = createHandlers({ ...ENV });
    const ticket: any = { kind: "guest", guestId: "e2e-guest-3", ipKey: null, settled: false };
    const req: any = {
      method: "POST",
      body: {
        claim: `${fixture.claim}（追问：案件已消失）`,
        followUp: true,
        caseId: PRIOR_CASE_ID,
        clientRequestId: "req-e2e-prior-gone",
      },
      checkTicket: ticket,
      headers: { cookie: owner.cookie, "x-real-ip": "203.0.113.23" },
      on: vi.fn(),
    };
    const { res, events } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(readObservations().length).toBe(before.length);
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(ticket.settled).toBe(true);
  });

  it("首轮请求：不做 caseId 校验、不写观测记录（行为与现状一致）", async () => {
    const other = await signIn("followup-other@test.dev");
    seedPriorCase(other.hash, "false", "https://prior.test/1");
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    const before = readObservations();

    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: fixture.claim,
        // 首轮带的是别人的 caseId 也没人拦：legacy 语义不动（caseId 只是本次 run 的坐标）
        caseId: "someone99",
        clientRequestId: "req-e2e-firstround",
      },
      checkTicket: { kind: "guest", guestId: "e2e-guest-4", ipKey: null, settled: false },
      headers: { cookie: other.cookie, "x-real-ip": "203.0.113.24" },
      on: vi.fn(),
    };
    const { res, events } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).not.toBe(400);
    expect(events.find((event) => event.type === "run_started")!.caseId).toBe("someone99");
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(fixture.lastFollowUpReuse).toBeUndefined();
    expect(readObservations().length).toBe(before.length);
  });

  it("访客无 caseId、带上一轮可见材料 → 管线收到 followUpReuse，不 400、不写观测", async () => {
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    const before = readObservations();
    const handlers = createHandlers({ ...ENV });
    const ticket: any = { kind: "guest", guestId: "e2e-guest-brief", ipKey: null, settled: false };
    const req: any = {
      method: "POST",
      body: {
        claim: `${fixture.claim}（追问：亚硝酸盐要吃多少才危险）`,
        followUp: true,
        priorRound: {
          originalClaim: fixture.claim,
          conclusion: "上一轮的结论",
          claims: [
            {
              text: fixture.atomA,
              judgment: "supported",
              evidence: [{ url: fixture.supportUrl, title: "支持来源", excerpt: "s", role: "support" }],
            },
          ],
        },
        clientRequestId: "req-e2e-guest-brief",
      },
      checkTicket: ticket,
      headers: { "x-real-ip": "203.0.113.31" },
      on: vi.fn(),
    };
    const { res, events } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).not.toBe(400);
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(ticket.settled).toBe(true);
    expect(fixture.lastFollowUpReuse).toMatchObject({
      priorClaim: fixture.claim,
      priorReport: expect.objectContaining({
        conclusion: "上一轮的结论",
        subclaimVerdicts: [
          expect.objectContaining({
            claimAtom: fixture.atomA,
            verdict: "true",
          }),
        ],
      }),
    });
    expect(readObservations().length).toBe(before.length);
  });

  it("访客无 caseId、无上一轮材料 → 不传 followUpReuse，完整管道，不 400", async () => {
    fixture.report = {
      originalClaim: fixture.claim,
      verdictType: "true",
      conclusion: "这一轮结论",
      citationSources: [{ url: fixture.supportUrl, title: "支持来源" }],
    };
    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: `${fixture.claim}（追问：所以呢）`,
        followUp: true,
        clientRequestId: "req-e2e-guest-full",
      },
      checkTicket: { kind: "guest", guestId: "e2e-guest-full", ipKey: null, settled: false },
      headers: { "x-real-ip": "203.0.113.32" },
      on: vi.fn(),
    };
    const { res, events } = mockRes();

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).not.toBe(400);
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(fixture.lastFollowUpReuse).toBeUndefined();
  });
});
