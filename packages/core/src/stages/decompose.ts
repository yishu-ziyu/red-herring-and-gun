import { Type } from "typebox";
import type { Claim, ClaimAtomType } from "../casefile/schema.js";
import { claimAtomKey, runClaimAtomSelfProof, type SelfProofModelCall } from "../text/claimAtom/index.js";
import type { StageContext } from "./context.js";
import { DecomposeOutputSchema } from "./decompose.schema.js";
import { parseJobOutput } from "./parseOutput.js";

export type DecomposeInput = {
  claimSource: string;
  parts?: readonly string[];
  completeParts?: readonly number[];
  needsContext?: boolean;
};
export type DecomposeOrigin = "model" | "fail-open" | "empty";
export type DecomposeResult = { claims: Claim[]; origin: DecomposeOrigin };

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
  "你是拆题填写。任务：把用户原句拆成能独立核对的判断，填 type、checkable、原句位置。不判对错，不打分。",
  "",
  "只要原句作出了可核对的判断就是可核对命题，不因太琐碎、像八卦、像个人纠纷、没有大政策标 false，也不得整句丢掉。",
  "",
  "硬要求：",
  "1. 每条必须是原句真实说的一个判断，不加字，不补常识，指代词必须写成完整所指。",
  "2. 并列名词拆开；限定语、前提背景、证据缺失表述不单列。例外：前提本身是可公开核查的事实主张（统计数据、政策文件、公开事件）就单列。",
  "3. 能力与风险断言（会中毒、会致癌）按事实或因果标可查；纯未来无抓手才不可查。价值、规范、无关谩骂标不可查。",
  "4. 转述结构是一条，带来源写完整句。材料分多条先后补充时，本轮只拆当前说法，先前条目只作上下文。",
  "5. 事实因果比较概念的 checkable 必须为 true；价值规范必须为 false；预测个人按第 3 条，不得一律标 false。",
  "",
  "例子（输入 → 输出）：",
  "输入：中国体育代表团出征奥运会自带300多个空调和床垫",
  "输出：[{\"text\":\"中国体育代表团自带300多个空调\",\"type\":\"fact\",\"checkable\":true},{\"text\":\"中国体育代表团自带床垫\",\"type\":\"fact\",\"checkable\":true}]",
  "输入：扫码可领补贴，逾期视为弃权",
  "输出：[{\"text\":\"扫码可领2024年个人劳动补贴\",\"type\":\"fact\",\"checkable\":true}]（逾期是限定语，不单列）",
  "输入：孩子打疫苗后发烧，说明疫苗导致了自闭症",
  "输出：[{\"text\":\"疫苗导致自闭症\",\"type\":\"causal\",\"checkable\":true}]（发烧是前提，不单列；前提不拆，只拆断言）",
  "输入：点早安晚安图片手机会中毒，个人信息会被盗",
  "输出：[{\"text\":\"点早安晚安图片会导致手机中毒\",\"type\":\"causal\",\"checkable\":true},{\"text\":\"点早安晚安图片会导致个人信息被盗\",\"type\":\"causal\",\"checkable\":true}]",
  "输入：电动车都被集中拉去国外销毁了，一批一批装船运走",
  "输出：[{\"text\":\"电动车被集中装船运往国外销毁\",\"type\":\"fact\",\"checkable\":true}]（同一事件多个描述侧面合成一条）",
  "输入：群里那张P图配的侮辱性文字说的是真的",
  "输出：[{\"text\":\"那段侮辱性文字说的是真的\",\"type\":\"fact\",\"checkable\":true}]（P图和配文是背景，不单列）",
  "输入：同事群里说我们公司下周一会被收购，没有公告也没有监管披露",
  "输出：[{\"text\":\"我们公司下周一会被收购\",\"type\":\"fact\",\"checkable\":true}]（没有公告是限定语，不单列）",
  "输入：某地推广该保健品后癌症死亡率下降，证明该保健品能防癌",
  "输出：[{\"text\":\"某地推广该保健品后癌症死亡率下降\",\"type\":\"fact\",\"checkable\":true},{\"text\":\"该保健品能防癌\",\"type\":\"causal\",\"checkable\":true}]",
  "",
  "位置：用原句中的字符下标 { start, end }，end 为开区间，指向该命题对应的原句子串。若无法对齐可省略。",
  "",
  "输出严格 JSON（不要 Markdown，不要代码块）：",
  "{\"claims\": [{\"text\": \"判断1\", \"type\": \"fact\", \"checkable\": true, \"span\": {\"start\": 0, \"end\": 5}}]}",
  "只许填 claims。不要写核对结论，不要写分数，不要发明原句没有的命题。",
].join("\n");

type DraftClaim = {
  text: string;
  type: ClaimAtomType;
  checkable: boolean;
  span?: { start: number; end: number };
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

function keepSpan(span: { start: number; end: number } | undefined, source: string): { start: number; end: number } | undefined {
  if (!span) return undefined;
  if (span.start < 0 || span.end > source.length || span.end <= span.start) return undefined;
  return span;
}

/**
 * 位置校准：模型给的位置只验算不盲信。
 * 先看模型位置盖住的原句和命题有没有一半以上重合，有就用模型的；
 * 没有就拿命题里两两相邻的字去原句里找，用盖住所有命中的最小区间；
 * 命题里一半字都找不到就不要位置，命题留下。
 */
/**
 * 命题里一半以上的字能在原句里找到才算落地，找不到就是加戏，当场删掉，命题不留。
 * resolveSpan 只管位置对不对，这里管命题本身留不留。
 */
export function claimGroundedInSource(text: string, source: string): boolean {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length === 0 || !source) return false;
  const found = new Set<number>();
  for (let i = 0; i < chars.length - 1; i += 1) {
    const pair = chars[i]! + chars[i + 1]!;
    if (/\s/.test(pair)) continue;
    if (source.indexOf(pair) >= 0) {
      found.add(i);
      found.add(i + 1);
    }
  }
  return found.size >= 4 && found.size / chars.length >= 0.5;
}

export function resolveSpan(
  text: string,
  span: { start: number; end: number } | undefined,
  source: string,
): { start: number; end: number } | undefined {
  const chars = [...text.replace(/\s+/g, "")];
  const overlap = (a: string, b: string): number => {
    if (!a || !b) return 0;
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    return longer.includes(shorter) ? shorter.length / longer.length : 0;
  };
  if (span) {
    const covered = source.slice(span.start, span.end).replace(/\s+/g, "");
    const needle = chars.join("");
    if (covered && needle && overlap(covered, needle) >= 0.5) return span;
  }
  if (chars.length === 0 || !source) return undefined;
  const found = new Set<number>();
  const hits: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const pair = chars[i]! + chars[i + 1]!;
    if (/\s/.test(pair)) continue;
    const at = source.indexOf(pair);
    if (at >= 0) {
      hits.push({ start: at, end: at + pair.length });
      found.add(i);
      found.add(i + 1);
    }
  }
  if (hits.length === 0 || found.size < 4 || found.size / chars.length < 0.5) return undefined;
  return { start: Math.min(...hits.map((h) => h.start)), end: Math.max(...hits.map((h) => h.end)) };
}

function nextClaimNumber(ctx: StageContext): number {
  let max = 0;
  const consider = (id: string) => {
    const match = /^c(\d+)$/.exec(id);
    if (!match) return;
    const n = Number(match[1]);
    if (n > max) max = n;
  };
  for (const claim of ctx.current.claims) consider(claim.id);
  for (const dropped of ctx.current.droppedClaims) consider(dropped.id);
  return max + 1;
}

function toClaims(ctx: StageContext, drafts: DraftClaim[]): Claim[] {
  const start = nextClaimNumber(ctx);
  return drafts.map((draft, i) => {
    const claim: Claim = {
      id: `c${start + i}`,
      text: draft.text,
      type: draft.type,
      checkable: draft.checkable,
      order: i,
    };
    if (draft.span) claim.span = draft.span;
    return claim;
  });
}

const FRAGMENT_TAIL = /(宣布|表示|称|指出|发布|说|透露|回应|通报|认为|强调)(了)?$/;
const FRAGMENT_PLACEHOLDER = /某事|某些内容|某项|某种|该事项|该内容|该政策|上述|前述/;
const HEARSAY_PREFIX = /^(听说|据说|网传|有人说|朋友圈说|群里说|听人说|据传)[，,：:、\s]*/;

function stripHearsayPrefix(text: string): string {
  return text.replace(HEARSAY_PREFIX, "").trim();
}

// 长度只用来去掉一到三个字的残渣：4 个字装得下完整意思（自带床垫）。是不是完整意思，由第二遍检查和原文对照来定，不由长度定。
export function isFragmentClaim(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return [...compact].length < 4 || FRAGMENT_TAIL.test(compact) || FRAGMENT_PLACEHOLDER.test(compact);
}

function splitFragments(drafts: DraftClaim[]): { kept: DraftClaim[]; fragments: DraftClaim[] } {
  const kept: DraftClaim[] = [];
  const fragments: DraftClaim[] = [];
  for (const draft of drafts) {
    if (isFragmentClaim(draft.text)) fragments.push(draft);
    else kept.push(draft);
  }
  return { kept, fragments };
}

function compactGround(text: string): string {
  return stripHearsayPrefix(text)
    .replace(/\s+/g, "")
    .replace(/\p{P}+/gu, "")
    .replace(/\p{S}+/gu, "");
}

export function claimGroundedInCompleteParts(
  claimText: string,
  parts: readonly string[],
  completeParts: readonly number[],
): boolean {
  const needle = compactGround(claimText);
  if (!needle) return false;
  for (const n of completeParts) {
    const part = parts[n - 1];
    if (!part) continue;
    const hay = compactGround(part);
    if (!hay) continue;
    if (hay.includes(needle) || needle.includes(hay)) return true;
  }
  return false;
}

export function claimIsHistoryOnly(
  claimText: string,
  parts: readonly string[],
  completeParts: readonly number[],
): boolean {
  if (claimGroundedInCompleteParts(claimText, parts, completeParts)) return false;
  const history = parts.map((_, i) => i + 1).filter((n) => !completeParts.includes(n));
  return history.length > 0 && claimGroundedInCompleteParts(claimText, parts, history);
}

function sourceForFailOpen(input: DecomposeInput): string {
  if (input.parts && input.completeParts && input.completeParts.length > 0) {
    const chunks = input.completeParts
      .map((n) => input.parts![n - 1])
      .filter((part): part is string => Boolean(part?.trim()));
    if (chunks.length > 0) return chunks.join("\n");
  }
  return input.claimSource;
}

function failOpen(ctx: StageContext, input: DecomposeInput): DecomposeResult {
  const text = sourceForFailOpen(input);
  const claims = toClaims(ctx, [
    { text, type: "fact", checkable: true, span: { start: 0, end: text.length } },
  ]);
  ctx.emit({ type: "claims.added", claims });
  ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "failed-open" });
  return { claims, origin: "fail-open" };
}

function dropUnresolved(ctx: StageContext, drafts: DraftClaim[]): void {
  if (drafts.length === 0) return;
  const origin = ctx.current.droppedClaims.length;
  ctx.emit({
    type: "claims.dropped",
    dropped: drafts.map((item, i) => ({
      id: `d${origin + i + 1}`,
      text: item.text,
      reason: "unresolved-context",
    })),
  });
}

function buildDecomposeUserContent(input: DecomposeInput): string {
  const parts = input.parts ?? [];
  const completeParts = input.completeParts ?? [];
  if (parts.length === 0) {
    return ["原句：", input.claimSource, "", "请拆成 claims 数组。"].join("\n");
  }
  const contextIdx = parts.map((_, i) => i + 1).filter((n) => !completeParts.includes(n));
  const lines: string[] = [];
  if (contextIdx.length > 0) {
    lines.push("上下文（先前未获资格，不得单独立案，不得产出被本轮说法取代的重复命题）：");
    for (const n of contextIdx) lines.push(`【${n}】${parts[n - 1]}`);
  }
  if (completeParts.length > 0) {
    lines.push("本轮立案材料：");
    for (const n of completeParts) lines.push(`【${n}】${parts[n - 1]}`);
    if (input.needsContext) {
      lines.push("当前说法要靠上下文补全所指。只产出解析后的当前说法，不要把上下文条目各自再立命题。");
    } else {
      lines.push("当前说法已自足。不要把上下文写进命题。");
    }
  }
  lines.push("", "原句：", input.claimSource, "", "请拆成 claims 数组。");
  return lines.join("\n");
}

const SPLIT_CHECK_SCHEMA = Type.Object(
  { split: Type.Array(Type.String()) },
  { additionalProperties: false },
);

/** 并列标记：命题里有这些字才值得多花一次调用去查有没有合并。 */
const SPLIT_MARKER = /[和与、跟]/u;

const SPLIT_CHECK_PROMPT = [
  "你是拆题复核，只干一件事：看这条命题里有没有两个以上能独立核对的判断。",
  "并列的名词必须拆开：自带空调和床垫拆成自带空调、自带床垫；免票和补贴拆成免票、补贴。",
  "每条是原句里真实存在的一个判断，不改字、不加戏、不判真假。",
  "没有并列就原样返回一条。只输出 JSON：{\"split\":[\"第一条\",\"第二条\"]}。",
].join("\n");

async function splitCheck(
  ctx: StageContext,
  source: string,
  draft: DraftClaim,
): Promise<DraftClaim[] | null> {
  if (!SPLIT_MARKER.test(draft.text)) return null;
  let output: unknown;
  try {
    const result = await ctx.llm({
      job: "split-check",
      systemPrompt: SPLIT_CHECK_PROMPT,
      userContent: `原句：${source}\n命题：${draft.text}`,
      responseSchema: SPLIT_CHECK_SCHEMA,
      maxTokens: 1024,
    });
    output = result.output;
  } catch {
    return null;
  }
  const parsed = parseJobOutput(SPLIT_CHECK_SCHEMA, output);
  if (!parsed.ok) return null;
  const parts = parsed.value.split.map((s) => stripHearsayPrefix(s.trim())).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((text) => ({ text, type: draft.type, checkable: draft.checkable }));
}

export async function runDecompose(ctx: StageContext, input: DecomposeInput): Promise<DecomposeResult> {
  ctx.emit({ type: "stage.started", stage: "decompose" });
  let output: unknown;
  try {
    const result = await ctx.llm({
      job: "decompose",
      systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
      userContent: buildDecomposeUserContent(input),
      responseSchema: DecomposeOutputSchema,
      maxTokens: 4096,
    });
    output = result.output;
  } catch {
    return failOpen(ctx, input);
  }
  const parsed = parseJobOutput(DecomposeOutputSchema, output);
  if (!parsed.ok) {
    ctx.emit({ type: "error", stage: "decompose", message: parsed.reason });
    return failOpen(ctx, input);
  }

  const drafts: DraftClaim[] = parsed.value.claims.flatMap((item) => {
    const text = stripHearsayPrefix(item.text);
    if (!text) return [];
    const span = resolveSpan(text, keepSpan(item.span, input.claimSource), input.claimSource);
    return [
      {
        text,
        type: item.type,
        checkable: item.checkable,
        ...(span ? { span } : {}),
      },
    ];
  });
  const historyParts =
    input.parts && input.completeParts
      ? input.parts.map((_, i) => i + 1).filter((n) => !input.completeParts!.includes(n))
      : [];
  let grounded = drafts;
  if (historyParts.length > 0 && input.parts && input.completeParts && input.completeParts.length > 0) {
    const unresolved: DraftClaim[] = [];
    grounded = [];
    for (const draft of drafts) {
      const keep = input.needsContext
        ? !claimIsHistoryOnly(draft.text, input.parts, input.completeParts)
        : claimGroundedInCompleteParts(draft.text, input.parts, input.completeParts);
      if (keep) grounded.push(draft);
      else unresolved.push(draft);
    }
    dropUnresolved(ctx, unresolved);
  }
  const proofSource =
    input.needsContext && input.parts && input.parts.length > 0 ? input.parts.join("\n") : input.claimSource;
  const rawTexts = grounded.map((draft) => draft.text);

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
  const proof = await runClaimAtomSelfProof(proofSource, rawTexts, callModel);
  const byKey = indexDrafts(grounded);
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

  // 并列复核：含和/与/顿号的命题多花一次调用查有没有合并，拆出来的每条必须在原句落地
  const checkedDrafts: DraftClaim[] = [];
  for (const draft of keptDrafts) {
    const split = await splitCheck(ctx, proofSource, draft);
    if (!split) {
      checkedDrafts.push(draft);
      continue;
    }
    for (const part of split) {
      if (!claimGroundedInSource(part.text, proofSource)) {
        const origin = ctx.current.droppedClaims.length;
        ctx.emit({
          type: "claims.dropped",
          dropped: [{ id: `d${origin + 1}`, text: part.text, reason: "原句没说" }],
        });
        continue;
      }
      checkedDrafts.push({
        ...part,
        span: resolveSpan(part.text, undefined, proofSource),
      });
    }
  }

  const { kept, fragments } = splitFragments(checkedDrafts);
  if (fragments.length > 0) {
    const origin = ctx.current.droppedClaims.length;
    ctx.emit({
      type: "claims.dropped",
      dropped: fragments.map((item, i) => ({
        id: `d${origin + i + 1}`,
        text: item.text,
        reason: "fragment",
      })),
    });
  }
  if (kept.length === 0) {
    ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "ok" });
    return { claims: [], origin: "empty" };
  }
  const claims = toClaims(ctx, kept);
  ctx.emit({ type: "claims.added", claims });
  ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "ok" });
  return { claims, origin: "model" };
}
