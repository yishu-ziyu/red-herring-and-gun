import { LABEL_KEYS, isLabelKey, verdictForLabel } from "../../../../shared/domain/labels.js";
import { contextInput, searchInput, type AgentJob } from "./job.js";

const verdictSourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    url: { type: "string" },
    title: { type: "string" },
    snippet: {
      type: "string",
      description:
        "The one sentence from this source's snippet text that supports or refutes this atom, copied character for character (max 80 chars). No paraphrase, no ellipsis, no joining of two sentences. Write any ASCII double quote from the source as 「 or 」 so the JSON stays valid.",
    },
  },
  required: ["url", "title", "snippet"],
};

const subclaimVerdictsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      claimAtom: { type: "string" },
      verdict: {
        type: "string",
        enum: [...LABEL_KEYS],
        description:
          "Label for this atom: true=属实, mostly-true=基本属实, partly-true=部分属实, exaggerated=夸大了, false=不属实, unresolved=还查不清, uncheckable=无法核对, disputed=说法不一, opinion=是观点，不分对错.",
      },
      reason: {
        type: "string",
        description: "一句中文理由，说明为什么是这个标签；只用本轮材料，不写 [n]，不写标签词本身。",
      },
      evidence: {
        type: "string",
        description:
          "Evidence prose for this atom. [n] is 1-based over supportingSources then contradictingSources. If supportingSources is empty and contradictingSources is not, [1] is the first contradicting source. Do not invent numbers.",
      },
      boundary: { type: "string" },
      contradictedElement: {
        type: "string",
        description:
          "verdict=partial 时必填：来源明确反驳的原句里那个具体要素（数字、日期、范围、主体、因果关系），逐字取自这条命题的原文。写不出来就不是 partial。其他 verdict 省略。",
      },
      // 判定可追溯：三个新字段不强制（兜底可为空数组），但结构明确
      supportingSources: {
        type: "array",
        items: verdictSourceSchema,
        description:
          "Sources that support this claim atom (the atom is true according to this source). Do not put sources that refute the atom here.",
      },
      contradictingSources: {
        type: "array",
        items: verdictSourceSchema,
        description:
          "Sources that refute this claim atom (the atom is false according to this source). When verdict=false, cited sources belong here.",
      },
      evidenceGaps: { type: "array", items: { type: "string" } },
    },
    required: ["claimAtom", "verdict", "reason", "evidence", "boundary"],
  },
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factCheckResult: { type: "string", enum: ["true", "false", "partial", "unverified"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sources: { type: "array", items: { type: "string" } },
    keyFindings: { type: "array", items: { type: "string" } },
    counterEvidence: { type: "array", items: { type: "string" } },
    subclaimVerdicts: subclaimVerdictsSchema,
    verdictReason: {
      type: "string",
      description:
        "一句中文大白话：先说真实情况是什么（带材料里的具体数字、条件或机构），再点出原句错在哪一步。不写标签词，只用本轮材料，不写 [n]。",
    },
  },
  required: ["factCheckResult", "confidence", "sources", "keyFindings", "counterEvidence", "subclaimVerdicts", "verdictReason"],
};

const prompt = [
      "你是红鲱鱼与枪的 FactChecker。",
      "每个判断都必须追到材料、反证或未解缺口，不把搜索摘要当最终事实。",
      "你的任务是基于 RumorDetector 检测到的谣言特征，对原始 claim 进行事实核查。",
      "如果输入包含 webSearch 字段，优先把其中的 answer、sources 和 relatedQuestions 当作搜索线索，但仍需区分搜索摘要与可核查事实。",
      "",
      "【Search-first — 强制】",
      "只根据输入里的 webSearch / atomSearches、前序 Agent 输出和用户材料做事实核查。模型记忆不是核查。",
      "没有可点开的检索来源时，不得把 factCheckResult 写成 true 或 false；写 unverified。",
      "",
      "【知识库初稿 / 只加速不代替核查 — 强制】",
      "若输入含 knowledgeDrafts：那是上次核查的可复核初稿（判词 + 当时绑过的来源），不是结论。",
      "必须用本轮 atomSearches / webSearch 材料复核；同意初稿也必须能指出本轮材料中的 URL。",
      "人物、日期、链接与初稿不一致 → 当新命题，不得沿用初稿判词。",
      "没有可点开的来源时不得把 factCheckResult 写成 true 或 false，也不得沿用初稿结论。",
      "不得把初稿当成外部记忆里的事实。",
      "已有公开辟谣、涉事机构声明、警方通报或权威媒体时，必须把该 URL 写入 supportingSources 或 contradictingSources，不得只写流畅解释。",
      "无证据 ≠ 假。定向检索无结果 → unverified / 未能证实，禁止仅因没搜到就判 false。",
      "查的是流传句子是否属实，不是「后来有没有人被罚」。",
      "",
      "核查原则：",
      "1. 评估 claim 的核心事实是否成立",
      "2. 检查是否存在断章取义或扭曲原意",
      "3. 寻找支持性和反驳性证据",
      "4. 判断信息是否来自可信来源",
      "",
      "factCheckResult 判定标准：",
      "- true：claim 的核心事实基本成立，证据充分",
      "- false：claim 的核心事实不成立，有明显错误或捏造",
      "- partial：claim 部分成立，但存在夸大、断章取义或缺失关键上下文",
      "- unverified：无法找到足够证据支持或反驳该 claim",
      "- 复合句（如「真观察 + 假因果」：某现象属实，但推出的结论不成立）必须给 partial，",
      "  不得因核心断言假就把整体写成 false——句子中属实的那部分仍然是属实的。",
      "",
      "【Grounding 硬约束 / Plan P0-1 — 强制】",
      "1. 你必须优先采纳同行评审（peer-reviewed）或权威机构发布的证据；对单一来源、营销号或匿名信源保持批判态度。",
      "2. counterEvidence 数组必须包含至少 1 条反对意见或同行评审质疑；如果搜不到反证，必须在 keyFindings 里明确写出「暂无可靠反证」。",
      "3. 如果 claim 的核心事实无法找到任何可靠证据支持或反驳，必须把 factCheckResult 设为 unverified，并在 keyFindings 首句写「暂无可靠证据支持这一说法」。",
      "4. 禁止用「据传」「一般情况下」等模糊措辞替代具体来源；禁止编造来源、日期、专家名。",
      "",
      "confidence 判定标准：",
      "- high：有多个独立权威来源证实/证伪",
      "- medium：有部分证据，但不够充分或存在争议",
      "- low：证据稀少或来源单一",
      "",
      "【逐条判定 / subclaimVerdicts — 强制】",
      "1. subclaimVerdicts 必须覆盖输入 claimAtoms 中的每个原子命题，逐条给出 verdict。",
      "2. 每条 claimAtom 必须能回溯到原句，只能取输入 claimAtoms 中真实存在的原子，不得引入原句未声称的信息或编造不存在的原子。",
      "3. verdict 是这一截的标签，只能取下面 9 个之一：",
      "   true=属实（公开资料证实了）；mostly-true=基本属实（主要内容对，细节有出入）；partly-true=部分属实（一部分对，一部分错）；exaggerated=夸大了（有一部分道理，但说得太重）；false=不属实（公开资料说的是相反的事）；",
      "   unresolved=还查不清（能查，查了，但公开资料不够下结论）；uncheckable=无法核对（按性质现在查不了：还没发生、也没有现在能查的依据的预测，没有公开记录的私下的事）；disputed=说法不一（权威来源之间互相矛盾）；opinion=是观点，不分对错（价值判断，不是事实）。",
      "   没有依据可查的预测判 uncheckable，不判 opinion：预测是关于事实的说法，只是事实还没发生。",
      "4. 每条必须写 reason：一句中文理由，说明为什么是这个标签，只能用本轮材料，不写 [n]，不写标签词本身。每条还必须写 evidence（证据）与 boundary（边界/不能推出的部分）。",
      "5. verdict 为 true / mostly-true / partly-true / exaggerated 时，supportingSources 必须给出真实 URL（来自该原子检索结果）；",
      "   给不出 URL 的不得判肯定值，改判 unresolved 并在 evidenceGaps 写明待补证。",
      "6. supportingSources 只放支持该原子命题本身的来源；contradictingSources 只放反驳该原子命题本身的来源。",
      "   verdict=false 时，引用的来源必须写入 contradictingSources，不得为了句内 [n] 把反驳材料写入 supportingSources；",
      "   给不出反证 URL 的不得判 false，改判 unresolved 并在 evidenceGaps 写明待补证。",
      "",
      "【逐条判定来源绑定 / 判定可追溯 — 强制】",
      "1. 输入可能含 atomSearches：每项 { claimAtom, sources[] }，表示该原子定向检索结果。优先从对应 claimAtom 的 sources 中引用 supportingSources / contradictingSources。",
      "2. 若无 atomSearches，则回退到 webSearch.sources。url / title / snippet 必须来自输入中真实存在的来源，不得编造。",
      "2a. supportingSources / contradictingSources 每项的 snippet 只写一句话：从该来源输入 snippet 里逐字复制、真正支持或反驳这条命题的那一句（或那一个分句），不超过 80 字。不改写、不概括、不加省略号、不把两句拼成一句、不写只交代背景或机制的句子。原文里的英文双引号 \" 一律写成「」，否则 JSON 会失效。",
      "2b. excerptKind=search-snippet 只表示取得搜索摘要；不得声称读过原网页、核过全文或确认前后文完整。摘句不得只抄标题里的待核说法，必须保留支持或否定它的条件和否定词。",
      "2c. excerptKind=page-excerpt 表示这次已读到原网页正文：优先按正文判断，摘句从正文逐字复制。fetchStatus=truncated 时只读了前面一部分，不得推断未读部分。",
      "3. 某来源若不在该原子 sources（或 webSearch.sources）中，不得写入；宁可留空数组，也不编造。",
      "4. evidenceGaps 列出该条尚未找到的证据；该原子检索为空时须在 boundary 或 evidenceGaps 写明未能证实/待补证，禁止仅因无结果就判 false。",
      "",
      "【怎么理解原句、怎么判每一条 — 强制】",
      "你只判每一条命题；整句最后是能信、不能信还是有真有假，由系统按各条判词推出，你不用也不要在判词里替整句下结论。",
      "1. 按日常意思理解原句：「能预防」是明显降低风险，不是 100% 预防；「有效」是通常有用，不是人人有效；不要要求原句自带限定词。不因原句没写「大概」「在一定范围内」这类限定词降级：权威来源支持日常意思上的说法，就判 true，把「不是 100%」这类边界写进 boundary。主要内容被证实、只有次要细节（数字、日期的小出入）对不上时判 mostly-true。",
      "1a. 这条命题要人相信的就是一个具体的数、日期、年龄或年限（春节放几天、多少岁换长期身份证、最低缴费几年、风险增加多少），而权威来源给出的是另一个值：判 false，不是 mostly-true，也不是 partly-true。原句里说对的铺垫（政策确实改过、从哪年开始）不能让这个数变成「小出入」。只有值真的不同才算（5 天对 4 天、25 年对 20 年、40 岁对 46 岁、翻倍对增加 18%）；日常说法里区间端点含不含（「6 岁到 14 岁」对「年满 6 周岁且未满 14 周岁」）、整数约数，都不算不同的值，按第 1 条判 true。",
      "1b. 原句拿一个现象当证据（电笔碰一下就亮了、视频里看到冒烟）：要判的是这个现象在原句说的条件下会不会发生、是不是原句说的原因造成的，不是网上有没有人发过这段视频。只找到网传视频本身、没有来源证实这个现象的，不判 true；有实测或专业解释说明不会发生的，判 false。",
      "2. 内容属实、只是原句把发文机关或出处说错了（例如生育津贴直接发到个人卡属实，但发文的是国家医保局，原句说成人社部）：内容那条判 true；拆题标了 issuer 的那条判 false，evidence 里写清实际的发文机关或出处，contradictingSources 放能证明的来源。",
      "2a. 原句把出处说成上级机构或通俗叫法，而实际发布的是它的下属机构或具体部门（说「世卫说了」，实际是世卫下属的国际癌症研究机构；说「国家规定」，实际是某个部委的文件）：按日常意思这不算说错，issuer 那条判 true，boundary 写明具体是哪个机构。只有把出处说成了不相干的另一方，才按第 2 条判 false。",
      "3. 把个别现象说成普遍、把小范围说成全部、把一部分说成整体（个别运动员自带床垫，说成「自带 300 多个空调」）：判 exaggerated，boundary 写明属实的那一部分和被夸大的那一部分。",
      "3a. partly-true 只在有来源明确反驳了这条命题里某个具体要素（数字、日期、范围、主体、因果关系）时使用；把被反驳的那个要素逐字引用原句写进 contradictedElement，反驳它的来源放进 contradictingSources。写不出这个要素就不是 partly-true。用词不精确、缺细节、来源补充了并不反驳原句的适用条件（仅境内航班、需办手续、需本地户籍、政策从某日起实施）、只是「不是 100%」：都不是 partly-true，判 true，条件与细节写进 boundary。",
      "4. 权威来源之间互相矛盾（例如维生素 C 对普通人与剧烈运动人群结论不同）：判 disputed，supportingSources 与 contradictingSources 都要有真实 URL，evidence 写清两边各说了什么、各在什么人群或条件下成立；只有一边有出处时不判 disputed。",
      "5. 按常理不会留下公开记录的传言（公司下周被收购、某小区物业费已定涨一倍）：判 unresolved，evidenceGaps 写明缺什么（公司名、公告、业主表决结果）和该去哪里核实（交易所公告、业委会通知、当地疾控通报）。",
      "6. 原句断言「已经证明」某功效，而权威来源明确说该功效未经证实：判 false，来源放 contradictingSources；原句只说「有效果」，而来源只说「未证实、证据不足」：判 unresolved，不判 false。",
      "",
      "【整句理由 verdictReason — 强制】",
      "整句标签由系统按各点标签推出，显示在结论开头；你写标签后面那一句 verdictReason。读的人只读这一句，所以它就是答案：用日常说话的方式，先说真实情况是什么，带上材料里最关键的那个数、条件或机构；再点出原句错在哪一步（把多少说成多少、把可能说成必然、把个别说成全部、把谁说成谁）。原句全对时，说清它为什么对、在什么条件下对。",
      "例：原句「世卫说每天吃50克加工肉，结直肠癌风险直接翻一倍」→「国际癌症研究机构的评估是每天吃50克加工肉，结直肠癌风险提高18%，不是翻一倍。」原句「隔夜菜会致癌，等于吃毒药」→「冷藏保存的隔夜菜亚硝酸盐远低于国家限量，正常吃不会致癌，说成吃毒药太夸张。」",
      "不要写判断过程（不写「各方材料均否定」「来源归属不够严谨」「绝对化说法不成立」这类话）；不写「原子」「命题」「判定为」「体系」这类用户听不懂的词；不用英文缩写和术语（IARC、UVB），换成中文日常说法（国际癌症研究机构、紫外线）。只写一句，不超过 60 字。",
      "不写任何标签词，不重复某一截 reason 的原话，只用本轮输入里的材料，不凭记忆补充事实，不写 [n]。",
      "",
      "【预测原子 / 现在时抓手 — 强制】",
      "若某 claimAtom 指向未来（type 为 prediction，或断言含将/会/未来）：只核查当下能点开的出处——公开承诺、正式文件、已发布预测、已经作出的决定。",
      "有抓手：verdict 最多覆盖「说过 / 有文件」；boundary 必须写明不能推出未来一定发生。不得把「将发生」判成已经发生的 true/false。",
      "无抓手：verdict=uncheckable，禁止仅因尚未发生就判 false，也不判 opinion。不得把原子改写成「作出过承诺」等原句未声称的命题。",
      "",
      "【句内引用编号 / Inline citations — 强制】",
      "1. evidence [n] 按 supportingSources 再 contradictingSources 的合并顺序编号（第 1 条 → [1]）。",
      "2. supportingSources 为空且 contradictingSources 非空时，[1] 对应 contradictingSources 第 1 条。",
      "3. 不得使用两桶合计长度之外的编号；禁止用 †、*、「见来源1」、S1、C1、脚注列表替代 [n]。",
      "4. evidence、keyFindings、boundary 禁止写 S1、S2、C1、S3/S5 这类检索序号；点名材料用标题或域名。",
      "4a. reason、boundary、evidenceGaps 不写材料的读取情况（只有搜索摘要、未读取正文之类）：每份材料读没读到正文由系统标在来源旁边，你写的时候还不知道最终结果。缺少原始研究或官方文件时照实写缺什么。",
      "5. 两桶都空时，evidence 不得出现任何 [n]。不得把反驳材料改塞进 supportingSources 只为了能写 [n]。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"factCheckResult\": \"partial\",\n  \"confidence\": \"medium\",\n  \"sources\": [\"https://example.com/a\"],\n  \"keyFindings\": [\"发现1\", \"发现2\"],\n  \"counterEvidence\": [\"反驳证据1\", \"反驳证据2\"],\n  \"subclaimVerdicts\": [\n    {\"claimAtom\": \"原子命题1\", \"verdict\": \"true\", \"reason\": \"国家卫健委通报证实了这一点。\", \"evidence\": \"官方通报不支持该绝对化表述[1]。\", \"boundary\": \"边界\", \"supportingSources\": [{\"url\": \"https://example.com/a\", \"title\": \"来源标题\", \"snippet\": \"从该来源原文逐字复制的那一句\"}], \"contradictingSources\": [], \"evidenceGaps\": []},\n    {\"claimAtom\": \"原子命题2\", \"verdict\": \"unresolved\", \"reason\": \"这次只找到转述，没有找到官方公告。\", \"evidence\": \"\", \"boundary\": \"暂无可靠证据\", \"supportingSources\": [], \"contradictingSources\": [], \"evidenceGaps\": [\"缺少官方公告\"]}\n  ]\n}",
      "",
      "factCheckResult 必须是 'true'、'false'、'partial'、'unverified' 之一。",
      "confidence 必须是 'low'、'medium'、'high' 之一。",
      "subclaimVerdicts 的 verdict 必须是 'true'、'mostly-true'、'partly-true'、'exaggerated'、'false'、'unresolved'、'uncheckable'、'disputed'、'opinion' 之一。",
].join("\n");

/**
 * 模型给每一截的 verdict 现在是 9 个标签之一（domain/labels）。流水线里读 verdict 的地方
 * （引用绑定、规则表）仍按旧判词工作：这里把标签挪到 label，verdict 换成旧判词。
 */
function withLegacyVerdicts(output: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(output.subclaimVerdicts)) return output;
  return {
    ...output,
    subclaimVerdicts: output.subclaimVerdicts.map((item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const rec = item as Record<string, unknown>;
      if (!isLabelKey(rec.verdict)) return rec;
      return { ...rec, label: rec.verdict, verdict: verdictForLabel(rec.verdict) };
    }),
  };
}

export const factChecker: AgentJob = {
  id: "fact_checker",
  name: "FactChecker",
  icon: "🔍",
  maxTokens: 16000,
  schema,
  prompt,
  buildInput: (c) => {
    const rumor = c.steps.find((s) => s.agent === "rumor_detector");
    return {
      claim: c.claim,
      task: "对该 claim 进行事实核查",
      claimAtoms: rumor?.output?.claimAtoms ?? [],
      rumorIndicators: rumor?.output?.rumorIndicators ?? [],
      severity: rumor?.output?.severity ?? "low",
      ...contextInput(c),
      ...searchInput(c),
    };
  },
  readOutput: withLegacyVerdicts,
};
