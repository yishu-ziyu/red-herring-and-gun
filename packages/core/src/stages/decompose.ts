import type { Claim, ClaimAtomType } from "../casefile/schema.js";
import {
  claimAtomKey,
  forceCheckableAtomTypes,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../text/claimAtom/index.js";
import type { StageContext } from "./context.js";
import { DecomposeOutputSchema } from "./decompose.schema.js";
import { parseJobOutput } from "./parseOutput.js";

export type DecomposeInput = { claimSource: string };
export type DecomposeResult = { claims: Claim[] };

const CLAIM_ATOM_TYPES: readonly ClaimAtomType[] = [
  "fact",
  "causal",
  "comparison",
  "concept",
  "value",
  "prediction",
  "normative",
  "personal",
];

export const DECOMPOSE_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的拆题工单填写器。",
  "你的任务是把用户原句拆成原子命题，标出类型、可否核对、以及该命题在原句中的 span。只填写工单，不要作核对结论，不要给命题打分。",
  "",
  "【流传短句 — 强制】",
  "网传一句、群聊转述、截图配文、谁给谁打电话、某地免票、某地要建地铁、打架、P图、偷车至境外——只要原句作出了可核对的判断，就是可核对命题。",
  "不得因「太琐碎」「像八卦」「像个人纠纷」「没有大政策」把 checkable 标 false，也不得整句丢掉。",
  "",
  "原子命题的判定标准（拆分时严格遵循）：",
  "1. 每个原子命题必须是一个独立、可单独核对的判断——要么是某个个体/对象的性质，要么是两个个体/对象之间的关系。",
  "2. 每个命题必须能回溯到原句，只能由用户提供的原句直接支持，不得引入原句未声称的信息、补全上下文或加入你自己的常识。",
  "3. 若原句含独立判断（如「药能治失眠」「药已获批准」），必须拆成多个原子命题，不得合并成一条。",
  "4. 拆分完成后，把命题拼接回读一遍，确认每条都能回溯到原句——不能回溯的删掉。",
  "5. 拆解不得删除原句的限定条件（「某种情况下 X」不得拆成「X」）。",
  "6. 不得产出无独立含义的碎片；能合并进同一判断的不要拆成多条。",
  "",
  "【可否核对 / type 与 checkable — 强制】",
  "对每个命题给出 checkable（是否可核对）与 type（类型）。",
  "硬不可核对（checkable=false，不进入后续核对）：",
  "- value 价值判断：对事物价值的评价（\"有意义/无意义\"\"好/坏\"\"应该/不应该\"）。示例如\"文科教育正在失去意义\"若指价值立场。",
  "- normative 规范命题：主张某人/某机构应当如何（\"政府应该禁止 X\"）。",
  "可核对（checkable=true）：",
  "- fact 事实陈述、causal 因果推断、comparison 比较命题、concept 概念定义。",
  "",
  "灰度区判定规则（按断言形态，不硬性归集）：",
  "- 个人经验 personal：凡断言形态是\"某人/某群体 报告/声称 某种经验或反应\"，可核对（去查是否有这些报告），checkable=true；凡属说话者第一人称主观体验或未经证实的普遍化主观判断，不可核对，checkable=false。示例：\"大量患者报告服用 X 后出现失眠\"→可核对（查是否有这些报告）；\"这药对我失眠很有效\"→不可核对。注意：即使机制未知（可能是安慰剂效应），只要形态是\"患者报告了反应\"就可核对\"是否有报告\"，但绝不能把该反应核对成药理作用（那是 causal，另标）。",
  "- 概念定义 concept：凡断言是\"某个概念定义是什么、出自哪里、不同语境如何被使用\"，可核对（查定义出处、语境、不同解释），checkable=true；凡断言是\"这个概念（根本）没有意义/不应该存在\"这类立场宣泄或规范判断，不可核对，checkable=false。",
  "- 预测 prediction：先找现在能点开的出处，再标明出处撑不到哪。凡有公开承诺、正式文件、已发布预测、已经作出的决定、规划/批复/立项等现在时抓手，checkable=true（去查抓手在不在；不能把未来写成已经发生）。示例：\"某公司未来三年营收将增长十倍\"→可核对（追有没有公开承诺）；\"某项政策已经正式确定并将立即实施\"→可核对（追有没有正式文件）；\"某地要建地铁\"→可核对（追有没有规划/批复，不要因为动词是「将/要」就跳过）。凡无现在时抓手、只是对世界的裸预测（\"未来三年就业会恶化\"），checkable=false。不得把原子改写成「作出过承诺」等原句未声称的命题。",
  "",
  "span：用原句中的字符下标 { start, end }，end 为开区间，指向该命题对应的原句子串。若无法对齐可省略 span。",
  "",
  "输出严格 JSON（不要 Markdown，不要代码块）：",
  "{\n  \"claims\": [\n    {\"text\": \"原子命题1\", \"type\": \"fact\", \"checkable\": true, \"span\": {\"start\": 0, \"end\": 5}},\n    {\"text\": \"原子命题2\", \"type\": \"value\", \"checkable\": false}\n  ]\n}",
  "",
  "value/normative 的 checkable 必须为 false；fact/causal/comparison/concept 的 checkable 必须为 true；prediction/personal 按上方灰度规则，不得一律标 false。",
  "只许填 claims。不要写核对结论，不要写分数，不要发明原句没有的命题。",
].join("\n");

type DraftClaim = {
  text: string;
  type: ClaimAtomType;
  checkable: boolean;
  span?: { start: number; end: number };
};

type ForceRow = {
  text: string;
  type: ClaimAtomType;
  verifiable: boolean;
};

function isClaimAtomType(value: unknown): value is ClaimAtomType {
  return typeof value === "string" && CLAIM_ATOM_TYPES.includes(value as ClaimAtomType);
}

function bindSelfProof(ctx: StageContext): SelfProofModelCall {
  return async (input) => {
    const result = await ctx.llm({
      job: "self-proof",
      systemPrompt: input.systemPrompt,
      userContent: input.userContent,
      responseSchema: input.responseSchema,
      maxTokens: input.maxTokens,
    });
    return { output: result.output, model: result.model };
  };
}

function indexDrafts(drafts: DraftClaim[]): Map<string, DraftClaim> {
  const map = new Map<string, DraftClaim>();
  for (const draft of drafts) {
    const key = claimAtomKey(draft.text.trim());
    if (key && !map.has(key)) map.set(key, draft);
  }
  return map;
}

function applyForceCheckable(drafts: DraftClaim[]): DraftClaim[] {
  const rows: ForceRow[] = drafts.map((draft) => ({
    text: draft.text,
    type: draft.type,
    verifiable: draft.checkable,
  }));
  const rewritten = forceCheckableAtomTypes(rows);
  if (!Array.isArray(rewritten)) return drafts;
  return drafts.map((draft, i) => {
    const item = rewritten[i];
    if (!item || typeof item !== "object") return draft;
    const verifiable = "verifiable" in item && typeof item.verifiable === "boolean" ? item.verifiable : draft.checkable;
    const type = "type" in item && isClaimAtomType(item.type) ? item.type : draft.type;
    return { ...draft, checkable: verifiable, type };
  });
}

function keepSpan(span: { start: number; end: number } | undefined, source: string): { start: number; end: number } | undefined {
  if (!span) return undefined;
  if (span.start < 0 || span.end > source.length || span.end <= span.start) return undefined;
  return span;
}

function toClaims(ctx: StageContext, drafts: DraftClaim[]): Claim[] {
  const start = ctx.current.claims.length;
  return drafts.map((draft, i) => {
    const claim: Claim = {
      id: `c${start + i + 1}`,
      text: draft.text,
      type: draft.type,
      checkable: draft.checkable,
      order: i,
    };
    if (draft.span) claim.span = draft.span;
    return claim;
  });
}

function failOpen(ctx: StageContext, claimSource: string): DecomposeResult {
  const claims = toClaims(ctx, [{ text: claimSource, type: "fact", checkable: true }]);
  ctx.emit({ type: "claims.added", claims });
  ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "failed-open" });
  return { claims };
}

export async function runDecompose(ctx: StageContext, input: DecomposeInput): Promise<DecomposeResult> {
  ctx.emit({ type: "stage.started", stage: "decompose" });
  let output: unknown;
  try {
    const result = await ctx.llm({
      job: "decompose",
      systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
      userContent: ["原句：", input.claimSource, "", "请拆成 claims 数组。"].join("\n"),
      responseSchema: DecomposeOutputSchema,
      maxTokens: 1000,
    });
    output = result.output;
  } catch {
    return failOpen(ctx, input.claimSource);
  }
  const parsed = parseJobOutput(DecomposeOutputSchema, output);
  if (!parsed.ok) {
    ctx.emit({ type: "error", stage: "decompose", message: parsed.reason });
    return failOpen(ctx, input.claimSource);
  }

  const drafts: DraftClaim[] = parsed.value.claims.map((item) => {
    const span = keepSpan(item.span, input.claimSource);
    return {
      text: item.text,
      type: item.type,
      checkable: item.checkable,
      ...(span ? { span } : {}),
    };
  });
  const rawTexts = drafts.map((draft) => draft.text);

  let selfProofError: string | undefined;
  const callModel: SelfProofModelCall = async (params) => {
    try {
      return await bindSelfProof(ctx)(params);
    } catch (err) {
      selfProofError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  };
  // runClaimAtomSelfProof 吞掉 callModel 抛错并保留原子；抛错时发 error，不整段失败开放。
  const proof = await runClaimAtomSelfProof(input.claimSource, rawTexts, callModel);
  const byKey = indexDrafts(drafts);
  const keptDrafts: DraftClaim[] = [];
  for (const key of proof.kept) {
    const draft = byKey.get(key);
    keptDrafts.push(draft ? { ...draft, text: key } : { text: key, type: "fact", checkable: true });
  }

  if (!selfProofError && proof.dropped.length > 0) {
    const origin = ctx.current.droppedClaims.length;
    ctx.emit({
      type: "claims.dropped",
      dropped: proof.dropped.map((item, i) => ({
        id: `d${origin + i + 1}`,
        text: item.text,
        reason: item.reason,
      })),
    });
  }
  if (selfProofError) {
    ctx.emit({ type: "error", message: selfProofError, stage: "decompose" });
  }

  const forced = applyForceCheckable(keptDrafts);
  if (forced.length === 0) return failOpen(ctx, input.claimSource);
  const claims = toClaims(ctx, forced);
  ctx.emit({ type: "claims.added", claims });
  ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "ok" });
  return { claims };
}
