import { contextInput, searchInput, type AgentJob } from "./job.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceReliability: { type: "string", enum: ["high", "medium", "low", "unverified"] },
    verifiedSources: { type: "array", items: { type: "string" } },
    questionableSources: { type: "array", items: { type: "string" } },
    missingSources: { type: "array", items: { type: "string" } },
    verificationNotes: { type: "string" },
    claimSourceRelations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimAtom: { type: "string" },
          url: { type: "string" },
          relation: { type: "string", enum: ["support", "contradict", "context-only", "unverified"] },
          reason: { type: "string" },
          quote: { type: "string", description: "从实际取得的材料逐字摘出、表达这个方向的一句；没有合适的原句就留空。" },
        },
        required: ["claimAtom", "url", "relation", "reason", "quote"],
      },
    },
  },
  required: ["sourceReliability", "verifiedSources", "questionableSources", "missingSources", "verificationNotes", "claimSourceRelations"],
};

const prompt = [
      "你是红鲱鱼与枪的 SourceValidator。",
      "先问来源是谁、是否原始、是否可追溯，再决定能不能进入证据链。",
      "你的任务是验证原始 claim 中提到的信源的可靠性和真实性。",
      "如果输入包含 webSearch 字段，请把其中的 sources 纳入信源验证，区分权威来源、媒体线索和社交传播线索。",
      "",
      "验证维度：",
      "1. 信源是否存在 — 提到的机构、研究、专家是否真实存在",
      "2. 信源权威性 — 是否为该领域的权威机构或专家",
      "3. 引用准确性 — 是否断章取义或扭曲原意",
      "4. 可追溯性 — 读者是否能通过公开渠道验证",
      "5. 命题—段落方向 — 对 atomSearches 中每个 claimAtom 与其来源，判断该来源的完整上下文究竟支持、反驳、仅提供背景，还是上下文不足无法判断。关系属于 claimAtom+URL，不属于整个网站。",
      "",
      "sourceReliability 判定标准：",
      "- high：claim 中的信源均可验证，且权威可靠",
      "- medium：部分信源可验证，或存在轻微引用不精确",
      "- low：信源可疑、无法验证，或存在明显断章取义",
      "- unverified：无法确定信源真实性（如「内部消息」「知情人士」）",
      "",
      "【Grounding 硬约束 / Plan P0-1 — 强制】",
      "1. 优先评估信源是否经过同行评审、官方发布或多家独立媒体交叉验证；对单一渠道、自媒体、匿名爆料一律按 unverified 计入。",
      "2. verificationNotes 首句必须给出明确判断；如果确实找不到可靠来源，必须以「暂无可靠证据支持这一说法」开头。",
      "3. 禁止把可疑来源（营销号、匿名信源、AI 生成内容未署名）记入 verifiedSources；必须放进 questionableSources。",
      "4. missingSources 应主动列出关键缺口（原始数据、官方公告、原始论文 DOI 等），不要默认 placeholder。",
      "5. 禁止编造来源 URL、发布日期、机构署名；不在输入中出现的证据不得计入 verifiedSources。",
      "6. 输入 directionalCandidates 是 FactChecker 准备公开为支持/反驳的候选。claimSourceRelations 必须给 directionalCandidates 的每一行都输出一条 relation，不能跳过。claimAtom 取自 atomSearches 或 directionalCandidates，URL 只能是本轮任一 atomSearches 检索结果里真实出现的；同一句话另一部分搜到的 URL 也可以和这条 claimAtom 配对核验，不要求 URL 出现在这条 claimAtom 自己的检索结果里。必须阅读 snippet 的完整转折与限制，不能只看标题或前半句。",
      "6a. 来源 snippet 可能已升级为本次取得的正文（excerptKind=page-excerpt），优先按它核对方向；search-snippet 仍只是搜索摘要，不得说已读原网页、摘要完整或前后文完整。读取失败或截断时照实保留限制。",
      "6b. 对 support/contradict，在 claimSourceRelations.quote 逐字摘出 snippet 中表达该方向的一句，不超过80字，保留否定、条件与范围；不能只抄标题里的谣言或被否定的那句话。没有合适原句就 quote 留空，不改写。",
      "7. support = 来源作者的完整意思直接支持该命题；contradict = 完整意思直接否定该命题；context-only = 主题相关、支持局部机制但不足以支持/反驳整条命题，或对象/指标不同；unverified = 摘要太短、上下文不足。",
      "7a. 两个方向都要判断，不能只问「支持不支持」。原句是绝对化或普遍性说法（会致癌、能治愈、等于毒药、一定、所有人）时，来源说明「正常条件下不会发生」「只有特定条件（室温久放、变质、大剂量）才有风险」「冷藏保存是安全的」，就是 contradict：它否定了原句的普遍说法。只讲机制、没有对原句下结论时，才是 context-only。",
      "8. 「辟谣/流言/但是/杯水车薪」本身不能决定方向。同一 URL 对不同 claimAtom 可以有不同 relation。理论机制成立不等于实际疗效成立。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"sourceReliability\": \"medium\",\n  \"verifiedSources\": [\"可靠来源1\"],\n  \"questionableSources\": [\"可疑来源1\"],\n  \"missingSources\": [\"缺失来源1\"],\n  \"verificationNotes\": \"验证过程说明\",\n  \"claimSourceRelations\": [\n    {\"claimAtom\": \"原子命题\", \"url\": \"https://example.com/source\", \"relation\": \"context-only\", \"reason\": \"来源讨论相关机制，但对象/结果指标不同，不能直接支持该命题\", \"quote\": \"\"}\n  ]\n}",
      "",
      "sourceReliability 必须是 'high'、'medium'、'low'、'unverified' 之一。",
].join("\n");

const DIRECTIONAL_BUCKETS = [
  ["supportingSources", "support"],
  ["contradictingSources", "contradict"],
] as const;

type DirectionalSource = {
  source: Record<string, unknown>;
  url: string;
  relation: (typeof DIRECTIONAL_BUCKETS)[number][1];
};

/** Every source one verdict files as support or contradict, supporting bucket first; sources without a URL are skipped. */
export function directionalSources(verdict: unknown): DirectionalSource[] {
  const row = verdict && typeof verdict === "object" ? (verdict as Record<string, unknown>) : {};
  return DIRECTIONAL_BUCKETS.flatMap(([key, relation]) => {
    const sources = row[key];
    if (!Array.isArray(sources)) return [];
    return sources.flatMap((source) => {
      const url = source && typeof source === "object" && typeof source.url === "string" ? source.url.trim() : "";
      return url ? [{ source, url, relation }] : [];
    });
  });
}

/** The sources FactChecker would publish as support or contradict, one row per claimAtom and http(s) URL. */
export function directionalCandidates(verdicts: unknown, limit = 24) {
  if (!Array.isArray(verdicts)) return [];
  return verdicts
    .flatMap((raw) => {
      const claimAtom = raw && typeof raw === "object" && typeof raw.claimAtom === "string" ? raw.claimAtom : "";
      if (!claimAtom) return [];
      return directionalSources(raw)
        .filter(({ url }) => /^https?:\/\//i.test(url))
        .map(({ url, relation }) => ({ claimAtom, url, intendedRelation: relation }));
    })
    .slice(0, limit);
}

export const sourceValidator: AgentJob = {
  id: "source_validator",
  name: "SourceValidator",
  icon: "📋",
  maxTokens: 12000,
  schema,
  prompt,
  buildInput: (c) => {
    const rumor = c.steps.find((s) => s.agent === "rumor_detector");
    const factStep = [...c.steps].reverse().find((s) => s.agent === "fact_checker");
    return {
      claim: c.claim,
      task: "验证信源可靠性，并逐条核对 claimAtom 与检索来源完整上下文的方向关系",
      claimAtoms: rumor?.output?.claimAtoms ?? [],
      directionalCandidates: directionalCandidates(
        Array.isArray(factStep?.relationAuditCandidates)
          ? factStep.relationAuditCandidates
          : factStep?.output?.subclaimVerdicts
      ),
      rumorIndicators: rumor?.output?.rumorIndicators ?? [],
      ...contextInput(c),
      ...searchInput(c),
    };
  },
  readOutput: (raw) => raw,
};
