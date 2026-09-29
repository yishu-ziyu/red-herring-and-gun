/**
 * Golden 场景：每个场景是一次真实用户路径在服务端的全部可观察交互。
 *
 * 请求体尽量按生产前端的实际构造方式生成（同一批前端函数），不手写近似值：
 * 材料 intake、本机记忆召回 memoryRecall、追问 claim 与上一轮可见材料 priorRound、
 * 落库时附带的 investigationThread。
 *
 * 「可录」场景真实联网录音；「仅回放」场景在已有录音上扣住请求、删掉部分录音或不用录音，
 * 用来稳定复现停止、断线接回、重复提交、重启、故障、旧数据兼容、额度与 MCP。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLocalMemoryRecall } from "../src/lib/localMemoryRecall";
import { createKnowledgeBase } from "../src/lib/knowledgeBase";
import { composeFollowUpClaim, displayFollowUpClaim, previousAnswerText } from "../src/lib/composeFollowUpClaim";
import { visiblePriorRoundFromSnapshot } from "../src/lib/priorRoundBrief";
import { appendInvestigationRound, type InvestigationThread } from "../src/lib/investigationThread";
import type { InvestigationSnapshotV1 } from "../src/lib/investigation";
import { GOLDEN_DIR, type Frame, type Scenario, type ScenarioContext } from "./harness";

/** 固定的提交时刻：intake.createdAt 不进服务端指纹，但固定下来便于比对请求体。 */
const SUBMITTED_AT = 1_790_000_000_000;

type Intake = { text: string; links: Array<Record<string, unknown>>; images: Array<Record<string, unknown>>; createdAt: number };

function intakeOf(text: string, extras: Partial<Intake> = {}): Intake {
  return { text: text.trim(), links: [], images: [], createdAt: SUBMITTED_AT, ...extras };
}

/** 与 caseIntakePrimaryText 相同：材料的主文本。 */
function primaryText(intake: Intake): string {
  if (intake.text.trim()) return intake.text.trim();
  if (intake.links.length > 0) return `请核查链接内容：${intake.links.map((link) => link.url).join(" ")}`;
  if (intake.images.length > 0) return `请核查用户上传的 ${intake.images.length} 张图片材料。`;
  return "";
}

/** 与 useInvestigationRun.start 相同：空本机历史下的记忆召回。 */
async function memoryRecallFor(text: string, accountEmail: string | null = null) {
  return (await buildLocalMemoryRecall(createKnowledgeBase(accountEmail), text)) as unknown as Record<string, unknown>;
}

async function payloadFor(intake: Intake, clientRequestId: string, accountEmail: string | null = null) {
  const claim = primaryText(intake);
  return { claim, intake, memoryRecall: await memoryRecallFor(intake.text, accountEmail), clientRequestId };
}

async function firstRoundPayload(text: string, clientRequestId: string, extras: Partial<Intake> = {}, accountEmail: string | null = null) {
  return payloadFor(intakeOf(text, extras), clientRequestId, accountEmail);
}

/** 探针：首页每次加载都会调，这三条不计额度。 */
async function homeProbes(ctx: ScenarioContext) {
  await ctx.request("probe:health", "GET", "/api/models/health");
  await ctx.request("probe:models", "GET", "/api/models/list");
  await ctx.request("probe:quota", "GET", "/api/checks/quota");
}

/** 调查结束后的读取：刷新恢复用的两个接口。 */
async function afterRun(ctx: ScenarioContext, runId: string | undefined, label = "run") {
  if (!runId) {
    ctx.note(`${label}:no-run`, "没有 runId");
    return;
  }
  await ctx.request(`${label}:record`, "GET", `/api/investigations/${runId}`);
  await ctx.sse(`${label}:resume-after-0`, `/api/investigations/${runId}/events?after=0`);
}

/** 追问请求体：与 App.handleFollowUp 相同的拼装。 */
async function followUpPayload(input: {
  originalClaim: string;
  finalReport?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  question: string;
  priorCaseId?: string;
  clientRequestId: string;
  accountEmail?: string | null;
}) {
  const snapshot = input.snapshot as InvestigationSnapshotV1 | undefined;
  const previousAnswer =
    previousAnswerText((input.finalReport ?? null) as { conclusion?: string; memo?: string } | null) ||
    snapshot?.conclusion?.directAnswer ||
    "";
  const text = composeFollowUpClaim({ originalClaim: input.originalClaim, previousAnswer, followUp: input.question });
  const base = await payloadFor(intakeOf(text), input.clientRequestId, input.accountEmail ?? null);
  return {
    ...base,
    followUp: true,
    ...(input.priorCaseId ? { caseId: input.priorCaseId } : { priorRound: visiblePriorRoundFromSnapshot(snapshot ?? null) }),
  };
}

/** 与 App.persistResult 相同的落库请求体：报告附上本线程到这一轮为止的记录。 */
function durableReport(input: {
  finalReport: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  claim: string;
  localId: string;
  thread?: InvestigationThread;
  kind?: "initial" | "follow-up" | "recheck";
}) {
  const thread: InvestigationThread = input.thread ?? { version: 1, id: input.localId, originalClaim: input.claim, rounds: [] };
  const investigationThread = appendInvestigationRound(thread, {
    id: input.localId,
    kind: input.kind ?? "initial",
    question: displayFollowUpClaim(input.claim),
    snapshot: input.snapshot as InvestigationSnapshotV1,
  });
  return { report: { ...input.finalReport, investigationThread }, thread: investigationThread };
}

const isType = (type: string) => (frame: Frame) => frame.type === type;
const snapshotPhase = (frame: Frame) =>
  frame.type === "investigation_snapshot" ? String((frame.investigation as { phase?: string } | undefined)?.phase ?? "") : "";

const FACT_CHECKER = "你是红鲱鱼与枪的 FactChecker。";

const G01_CLAIM = "隔夜菜亚硝酸盐超标百倍，吃了直接致癌？真的假的？";
const G02_CLAIM = "听说电动车都被集中拉去国外销毁了，一批一批装船运走";
const G03_CLAIM = "每天喝红酒可以预防心脏病，因为法国人喝红酒且心脏病少";
const G04_CLAIM = "政府应该禁止短视频";
const G05_CLAIM = "同事群里说我们公司下周一会被收购，没有公告也没有监管披露";
const G06_TEXT = "微博上这条说上海地铁要全线停运一周 https://weibo.com/7654321/NhqWxyz12";
const G07_TEXT = "这张停水通知是真的吗？";

function waterNoticeImage() {
  const bytes = readFileSync(join(GOLDEN_DIR, "fixtures", "water-notice.png"));
  return { id: "image-golden-1", name: "water-notice.png", type: "image/png", size: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
}

/** 单轮调查场景（可录）。 */
function singleRun(world: string, description: string, build: () => Promise<Record<string, unknown>>): Scenario {
  return {
    world,
    recordable: true,
    description,
    async run(ctx) {
      await homeProbes(ctx);
      const run = await ctx.orchestrate("run", await build());
      await afterRun(ctx, run.runId);
    },
  };
}

export const scenarios: Record<string, Scenario> = {
  // ── 可录：真实联网 ─────────────────────────────────────────────
  "g01-mixed": singleRun("g01-mixed", "正常路径：真假缝在一起，末尾带元问句（隔夜菜亚硝酸盐）", () => firstRoundPayload(G01_CLAIM, "golden-g01")),
  "g02-debunk": singleRun("g02-debunk", "正常路径：有官方辟谣的流传说法（电动车装船销毁）", () => firstRoundPayload(G02_CLAIM, "golden-g02")),
  "g03-causal": singleRun("g03-causal", "边界：因果跳跃「因为…」，触发因果增强（红酒与心脏病）", () => firstRoundPayload(G03_CLAIM, "golden-g03")),
  "g04-stance": singleRun("g04-stance", "边界：立场句，不适用真假判断（禁止短视频）", () => firstRoundPayload(G04_CLAIM, "golden-g04")),
  "g05-unverified": singleRun("g05-unverified", "边界：没有公开材料可查（公司下周被收购）", () => firstRoundPayload(G05_CLAIM, "golden-g05")),
  "g06-link-failed": singleRun("g06-link-failed", "边界：文字 + 打不开的链接（抓取失败，只按文字查）", () => {
    const url = "https://weibo.com/7654321/NhqWxyz12";
    return firstRoundPayload(G06_TEXT, "golden-g06", {
      links: [{ id: "link-golden-1", url, hostname: "weibo.com", scrapedContent: "", scrapedAt: SUBMITTED_AT, scrapeStatus: "error", scrapeError: "链接抓取失败", scrapeFailed: true }],
    });
  }),
  "g07-image": singleRun("g07-image", "边界：截图材料（视觉解析 + 原图出处缺口）", () => firstRoundPayload(G07_TEXT, "golden-g07", { images: [waterNoticeImage()] })),
  "g08-followup-guest": {
    world: "g08-followup-guest",
    bases: ["g01-mixed"],
    recordable: true,
    description: "追问（访客）：首轮 g01，再带上一轮可见材料追问两次（覆盖与新问题）",
    async run(ctx) {
      const first = await ctx.orchestrate("round1", await firstRoundPayload(G01_CLAIM, "golden-g01"));
      const covered = await ctx.orchestrate(
        "round2-covered",
        await followUpPayload({ originalClaim: G01_CLAIM, finalReport: first.finalReport, snapshot: first.snapshot, question: "隔夜菜到底会不会致癌？", clientRequestId: "golden-g08-2" }),
      );
      await afterRun(ctx, covered.runId, "round2");
      const fresh = await ctx.orchestrate(
        "round3-new",
        await followUpPayload({ originalClaim: G01_CLAIM, finalReport: first.finalReport, snapshot: first.snapshot, question: "放冰箱冷藏的隔夜菜，亚硝酸盐还会超标吗？", clientRequestId: "golden-g08-3" }),
      );
      await afterRun(ctx, fresh.runId, "round3");
    },
  },
  "g09-account": {
    world: "g09-account",
    bases: ["g02-debunk"],
    recordable: true,
    env: { NODE_ENV: "" },
    description: "账号：登录 → 调查 → 存档 → 历史 → 私有页 → 分享预览/创建/读取/撤销 → 带 caseId 追问 → 存档",
    async run(ctx) {
      const email = "golden@example.com";
      await ctx.login("login", email);
      await ctx.request("me", "GET", "/api/auth/email/me");
      await ctx.request("quota", "GET", "/api/checks/quota");
      const run = await ctx.orchestrate("run", await firstRoundPayload(G02_CLAIM, "golden-g09", {}, email));
      if (!run.finalReport || !run.snapshot) throw new Error("首轮没有完成");
      const localId = "case-golden-g09";
      const durable = durableReport({ finalReport: run.finalReport, snapshot: run.snapshot, claim: G02_CLAIM, localId });
      const saved = await ctx.request("save", "POST", "/api/case", {
        claim: G02_CLAIM,
        report: durable.report,
        credibilityScore: typeof run.finalReport.credibilityScore === "number" ? run.finalReport.credibilityScore : 50,
      });
      const caseId = (saved.body as { caseId?: string }).caseId;
      await ctx.request("list", "GET", "/api/cases");
      await ctx.request("get", "GET", `/api/case/${caseId}`);
      await ctx.request("private-html", "GET", `/r/${caseId}`);
      await ctx.request("preview", "GET", `/api/cases/${caseId}/share-preview`);
      const share = await ctx.request("share", "POST", `/api/cases/${caseId}/shares`);
      const url = (share.body as { url?: string }).url ?? "";
      const token = url.replace(/^\/s\//, "");
      await ctx.request("share-html", "GET", url);
      await ctx.request("revoke", "DELETE", `/api/cases/${caseId}/shares/${token}`);
      await ctx.request("share-html-after-revoke", "GET", url);
      await ctx.request("revoke-again", "DELETE", `/api/cases/${caseId}/shares/${token}`);
      const follow = await ctx.orchestrate(
        "followup",
        await followUpPayload({ originalClaim: G02_CLAIM, finalReport: run.finalReport, snapshot: run.snapshot, question: "这些电动车是怎么处理的？", priorCaseId: caseId, clientRequestId: "golden-g09-2", accountEmail: email }),
      );
      if (follow.finalReport && follow.snapshot) {
        const followClaim = String((follow.request.body as { claim: string }).claim);
        const next = durableReport({ finalReport: follow.finalReport, snapshot: follow.snapshot, claim: followClaim, localId: "case-golden-g09-2", thread: durable.thread, kind: "follow-up" });
        await ctx.request("save-followup", "POST", "/api/case", { claim: followClaim, report: next.report, credibilityScore: 50 });
      }
      await ctx.request("list-after", "GET", "/api/cases");
      await ctx.request("logout", "POST", "/api/auth/email/logout");
      await ctx.request("get-after-logout", "GET", `/api/case/${caseId}`);
      await ctx.request("list-after-logout", "GET", "/api/cases");
    },
  },

  // ── 仅回放：在 g01 录音上制造中断、并发与重启 ─────────────────────
  "g10-cancel": {
    world: "g01-mixed",
    recordable: false,
    hold: FACT_CHECKER,
    description: "中断：检索完成、核查被扣住时点停止；迟到的核查回复不能改结局",
    async run(ctx) {
      const pending = ctx.orchestrate("run", await firstRoundPayload(G01_CLAIM, "golden-g10"));
      await ctx.waitHeld(1);
      const record = await waitRunId(ctx);
      await ctx.request("cancel", "POST", `/api/investigations/${record}/cancel`);
      await ctx.request("cancel-again", "POST", `/api/investigations/${record}/cancel`);
      ctx.release();
      const run = await pending;
      await afterRun(ctx, run.runId);
    },
  },
  "g11-detach-resume": {
    world: "g01-mixed",
    recordable: false,
    hold: FACT_CHECKER,
    description: "刷新：客户端在核查阶段断开，调查继续跑完；按 lastSeq 接回，再从头接回",
    async run(ctx) {
      const detached = await ctx.orchestrate("run", await firstRoundPayload(G01_CLAIM, "golden-g11"), {
        until: (frame, frames) => snapshotPhase(frame) === "investigating" && frames.filter((f) => snapshotPhase(f) === "investigating").length >= 2,
      });
      const runId = detached.runId!;
      await ctx.waitHeld(1);
      ctx.release();
      await waitTerminal(ctx, runId);
      const seqs = (detached.frames ?? []).filter(isType("investigation_activity")).map((f) => Number((f.activity as { seq?: number }).seq ?? 0));
      const lastSeq = Math.max(0, ...seqs);
      await ctx.sse("resume-after-last", `/api/investigations/${runId}/events?after=${lastSeq}`);
      await afterRun(ctx, runId);
    },
  },
  "g12-duplicate": {
    world: "g01-mixed",
    recordable: false,
    hold: FACT_CHECKER,
    description: "并发：同一 clientRequestId 重复提交只订阅原调查；换了材料则 409",
    async run(ctx) {
      const payload = await firstRoundPayload(G01_CLAIM, "golden-g12");
      const first = ctx.orchestrate("run", payload);
      await ctx.waitHeld(1);
      const second = ctx.orchestrate("duplicate", payload);
      await ctx.sleep(300);
      await ctx.orchestrate("conflict", await firstRoundPayload("隔夜菜会致癌", "golden-g12"));
      ctx.release();
      const [a] = await Promise.all([first, second]);
      await afterRun(ctx, a.runId);
    },
  },
  "g14-restart": {
    world: "g01-mixed",
    recordable: false,
    hold: FACT_CHECKER,
    description: "重启：核查阶段进程崩溃（SIGKILL），重启后这条调查是中断态，快照保留",
    async run(ctx) {
      const pending = ctx.orchestrate("run", await firstRoundPayload(G01_CLAIM, "golden-g14")).catch((error) => ({ error: String(error) }));
      await ctx.waitHeld(1);
      const runId = await waitRunId(ctx);
      await ctx.restart({ kill: true });
      await pending;
      ctx.release();
      await afterRun(ctx, runId, "after-restart");
      await ctx.request("cancel-after-restart", "POST", `/api/investigations/${runId}/cancel`);
    },
  },
  "g13-all-down": {
    world: "empty",
    recordable: false,
    description: "错误路径：所有外部服务都失败（模型、检索、探活全 503）",
    async run(ctx) {
      await homeProbes(ctx);
      const run = await ctx.orchestrate("run", await firstRoundPayload(G01_CLAIM, "golden-g13"));
      await afterRun(ctx, run.runId);
    },
  },
  "g15-search-down": {
    world: "g01-mixed",
    recordable: false,
    dropTapes: (tape) => /api\.360\.cn\/v2\/mwebsearch|tavily|exa\.ai|metaso|anysearch|coding_plan\/search|web_search/.test(tape.url),
    description: "错误路径：检索全部失败、模型正常",
    async run(ctx) {
      const run = await ctx.orchestrate("run", await firstRoundPayload(G01_CLAIM, "golden-g01"));
      await afterRun(ctx, run.runId);
    },
  },
  "g16-byo-fail": {
    world: "empty",
    recordable: false,
    env: { NODE_ENV: "" },
    description: "自带密钥：端点 401 → fail-closed，流以 byo_key_failed 结束，不回退 env 密钥",
    async run(ctx) {
      const fake = await startFakeLlm(401);
      try {
        const payload = {
          ...(await firstRoundPayload(G01_CLAIM, "golden-g16")),
          byoKey: { baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "sk-golden-byo-0000000000", modelName: "golden-model" },
        };
        const run = await ctx.orchestrate("run", payload);
        await afterRun(ctx, run.runId);
        await ctx.orchestrate("malformed", { ...(await firstRoundPayload(G01_CLAIM, "golden-g16b")), byoKey: { baseUrl: "ftp://x", apiKey: "" } });
        ctx.note("fake-llm-hits", String(fake.hits()));
      } finally {
        await fake.close();
      }
    },
  },
  "g17-legacy-data": {
    world: "empty",
    recordable: false,
    env: { NODE_ENV: "" },
    description: "数据兼容：旧版 cases.json 首次启动导入；旧报告无快照时确定性重建；坏报告不伪造",
    seed(dataDir) {
      writeFileSync(join(dataDir, "cases.json"), JSON.stringify(legacyCases()));
    },
    async run(ctx) {
      await ctx.login("login", LEGACY_EMAIL);
      await ctx.request("list", "GET", "/api/cases");
      for (const entry of legacyCases()) {
        await ctx.request(`get:${entry.caseId}`, "GET", `/api/case/${entry.caseId}`);
      }
      await ctx.request("private-html", "GET", "/r/legacy01");
      await ctx.request("private-html-missing", "GET", "/r/nosuchid");
      await ctx.restart();
      await ctx.request("list-after-restart", "GET", "/api/cases");
    },
  },
  "g18-quota": {
    world: "empty",
    recordable: false,
    env: { NODE_ENV: "production", CHECK_QUOTA_GUEST_LIMIT: "2", CHECK_QUOTA_IP_LIMIT: "20", AIPING_SESSION_SECRET: "golden-session-secret-0000000000" },
    description: "额度（生产模式）：访客每天 2 次；探针不计；第 3 次 429；test-llm 在生产 404",
    async run(ctx) {
      await homeProbes(ctx);
      await homeProbes(ctx);
      await ctx.orchestrate("run1", await firstRoundPayload(G01_CLAIM, "golden-g18-1"));
      await ctx.request("quota-after-1", "GET", "/api/checks/quota");
      await ctx.orchestrate("run2", await firstRoundPayload(G02_CLAIM, "golden-g18-2"));
      await ctx.request("quota-after-2", "GET", "/api/checks/quota");
      await ctx.orchestrate("run3", await firstRoundPayload(G03_CLAIM, "golden-g18-3"));
      await ctx.request("health-after-exhausted", "GET", "/api/models/health");
      await ctx.request("test-llm", "POST", "/api/agent/test-llm", { baseUrl: "https://example.com/v1", apiKey: "x" });
      await ctx.request("bad-json-case", "POST", "/api/case", { claim: "x" });
    },
  },
  "g19-mcp": {
    world: "empty",
    recordable: false,
    env: { NODE_ENV: "" },
    description: "MCP：信息、握手、工具列表、工具调用（当前恒返回 HTTP 404，见 rewrite-issues R1）",
    async run(ctx) {
      await ctx.request("info", "GET", "/mcp");
      await ctx.request("initialize", "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "golden", version: "1" } } });
      await ctx.request("tools-list", "POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
      await ctx.request("tools-call", "POST", "/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "red_herring_truth_check", arguments: { claim: G01_CLAIM } } });
      await ctx.request("tools-call-missing", "POST", "/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "red_herring_truth_check", arguments: {} } });
      await ctx.request("unknown-method", "POST", "/mcp", { jsonrpc: "2.0", id: 5, method: "nope" });
      await ctx.request("put", "PUT", "/mcp", {});
    },
  },
  "g20-bad-requests": {
    world: "empty",
    recordable: false,
    env: { NODE_ENV: "" },
    description: "错误请求：缺 claim、JSON 坏、modelChoice 非法、追问 caseId 不存在、未知 run、未登录写案件",
    async run(ctx) {
      await ctx.orchestrate("no-claim", { intake: intakeOf("") });
      await ctx.orchestrate("bad-model-choice", { ...(await firstRoundPayload(G01_CLAIM, "golden-g20-1")), modelChoice: { fact_checker: { provider: "nope", model: "x" } } });
      await ctx.orchestrate("followup-missing-case", { ...(await firstRoundPayload(G01_CLAIM, "golden-g20-2")), followUp: true, caseId: "zzzzzzzz" });
      await ctx.request("run-missing", "GET", "/api/investigations/00000000-0000-0000-0000-000000000000");
      await ctx.request("events-missing", "GET", "/api/investigations/00000000-0000-0000-0000-000000000000/events");
      await ctx.request("cancel-missing", "POST", "/api/investigations/00000000-0000-0000-0000-000000000000/cancel");
      await ctx.request("save-anonymous", "POST", "/api/case", { claim: "x", report: { conclusion: "y" } });
      await ctx.request("me-anonymous", "GET", "/api/auth/email/me");
      await ctx.request("list-anonymous", "GET", "/api/cases");
      await ctx.request("share-missing", "GET", "/s/doesnotexist");
      await ctx.request("feedback-empty", "POST", "/api/feedback", {});
      await ctx.request("feedback", "POST", "/api/feedback", { claim: "x", reason: "结论不对" });
    },
  },
};

// ── 辅助 ─────────────────────────────────────────────────────────

async function waitRunId(ctx: ScenarioContext): Promise<string> {
  // run_started 是流上第一帧；扣住核查时它早已写进 SQLite。经 SQLite 读最新一条 run。
  const { DatabaseSync } = await import("node:sqlite");
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    try {
      const db = new DatabaseSync(join(ctx.dataDir, "rhg.sqlite"), { readOnly: true });
      const row = db.prepare("SELECT runId FROM runs ORDER BY createdAt DESC LIMIT 1").get() as { runId?: string } | undefined;
      db.close();
      if (row?.runId) return row.runId;
    } catch {
      /* 库还没建好 */
    }
    await ctx.sleep(50);
  }
  throw new Error("等不到 runId");
}

async function waitTerminal(ctx: ScenarioContext, runId: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const db = new DatabaseSync(join(ctx.dataDir, "rhg.sqlite"), { readOnly: true });
    const row = db.prepare("SELECT status FROM runs WHERE runId = ?").get(runId) as { status?: string } | undefined;
    db.close();
    if (row?.status && ["completed", "interrupted", "cancelled"].includes(row.status)) return;
    await ctx.sleep(50);
  }
  throw new Error("调查没有到终态");
}

async function startFakeLlm(status: number) {
  const { createServer } = await import("node:http");
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    req.resume();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, hits: () => hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const LEGACY_EMAIL = "legacy@example.com";

/**
 * 旧版 cases.json 的几种真实形状：带快照的新报告、没有快照的旧报告、中断报告、坏报告、没时间的记录。
 * ownerHash 按回放环境的假会话密钥算出（与 accountStore.hashEmail 同一算法），登录后才读得到。
 */
function legacyCases() {
  const ownerHash = legacyOwnerHash();
  const report = (conclusion: string, verdictType: string) => ({
    conclusion,
    verdictType,
    subclaimVerdicts: [
      { claimAtom: "隔夜菜会致癌", verdict: verdictType === "false" ? "false" : "unverified", confidence: "medium", evidence: "测试证据", supportingSources: [], contradictingSources: verdictType === "false" ? [{ url: "https://www.piyao.org.cn/example", title: "辟谣" }] : [] },
    ],
    claimItems: [{ text: "隔夜菜会致癌", verifiable: true, type: "fact" }],
    credibilityScore: verdictType === "false" ? 8 : 50,
  });
  return [
    { caseId: "legacy01", claim: "隔夜菜会致癌", report: report("不会。隔夜菜不会直接致癌。", "false"), claimReview: {}, credibilityScore: 8, createdAt: 1_757_000_000_000, ownerHash },
    { caseId: "legacy02", claim: "喝咖啡会脱水", report: { _source: "error-boundary", conclusion: "" }, claimReview: {}, credibilityScore: 50, createdAt: 1_757_100_000_000, ownerHash },
    { caseId: "legacy03", claim: "没时间的旧记录", report: report("还没查清。", "unverified"), claimReview: {}, credibilityScore: 50, ownerHash },
    { caseId: "legacy04", claim: "坏报告", report: "not-an-object", claimReview: {}, credibilityScore: 50, createdAt: 1_757_200_000_000, ownerHash },
    { caseId: "legacy05", claim: "别人的记录", report: report("不会。", "false"), claimReview: {}, credibilityScore: 8, createdAt: 1_757_300_000_000, ownerHash: "someone-else" },
    { caseId: "legacy06", claim: "无主旧记录", report: report("不会。", "false"), claimReview: {}, credibilityScore: 8, createdAt: 1_757_400_000_000 },
  ];
}

/**
 * 与 accountStore.hashEmail 相同：sha256(`${email}|${secret}`)，email 先 trim + 小写。
 * secret 是 replayEnv 给 AIPING_SESSION_SECRET 的假值。算法若被改，登录后 get:* 会全部 404，比对会暴露出来。
 */
function legacyOwnerHash(): string {
  const secret = "golden-replay-aiping_session_secret-0000000000";
  return createHash("sha256").update(`${LEGACY_EMAIL.trim().toLowerCase()}|${secret}`, "utf8").digest("hex");
}

export { G01_CLAIM, afterRun, firstRoundPayload, followUpPayload, homeProbes, intakeOf, memoryRecallFor };
