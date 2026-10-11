/**
 * 进度页和结果页共用的文案。用词照文案准则 v2（说法、要点、资料、出处、依据、判断、结论、还缺、查不清），
 * 每一句都是文案评审（copy-review/review.csv）里定下的 final_copy；评审没有覆盖的，在旁边写明来由。
 * 两页说同一件事必须用同一句话，所以放在一处，不在组件里各写一份。
 */

export const journeyCopy = {
  /** 要点抬头（R14）。 */
  partHeading: (n: number) => `第 ${n} 个要点`,

  /** 还缺什么（I20）。模型写的缺口常以「缺少」开头，去掉它，免得读成「还缺：缺少……」。 */
  gapPrefix: "还缺：",
  gapLine: (description: string) => `还缺：${description.trim().replace(/^(缺少|缺乏|缺)对?/, "")}`,

  /**
   * 判断的边界（R17：「这个判断不适用于……」）。boundary 是模型写的自由文本，不一定以「不适用于」开头；
   * 只有它本来就是「不适用于……」时才接成这句，「不能推出……」接成「现有依据推不出……」（R12 的说法），其他原样显示，
   * 不能硬套句式改掉原意。
   */
  boundaryLine: (boundary: string) => {
    const text = boundary.trim();
    const body = /^不适用于/.test(text)
      ? `这个判断${text}`
      : /^不能推出/.test(text)
        ? `现有依据推不出：${text.replace(/^不能推出[：:]?/, "")}`
        : text;
    return /[。！？.!?]$/.test(body) ? body : `${body}。`;
  },

  /** 资料有支持也有反驳（I21）。原因我们不去猜（DECISIONS 2026-10-10：冲突原因显示未知）。 */
  conflictLine: (support?: ConflictSide, contradict?: ConflictSide) =>
    [
      "这个要点的资料有支持也有反驳。",
      support ? `${support.publisher}支持其中一部分${support.summary ? `（${support.summary}）` : ""}。` : "",
      contradict ? `${contradict.publisher}反驳另一部分${contradict.summary ? `（${contradict.summary}）` : ""}。` : "",
      "两边为什么不同，我们还没查清。",
    ].join(""),

  /** 没查完（I26、I27、I28）。提示放在各要点下面，所以说「留在上面」。 */
  interruptedTitle: "这次没有查完",
  interruptedBody: "已经找到的资料和查完的要点都留在上面。目前还没有结论。",
  interruptedMessage: "这次没有查完。已经找到的资料和查完的要点都留在上面。目前还没有结论。",
  retry: "重新调查",

  /** 全部资料（R10、R34、R35、R36）。 */
  allSources: (n: number) => `全部 ${n} 份资料`,
  drawerTitle: "全部资料",
  drawerSubtitle: (n: number) => `${n} 份 · 按与结论的关系排序`,
  drawerClose: "关闭",

  /** 资料行（R19、R20、R21、R22、R23）。 */
  showOrigin: "看出处",
  excerptFrom: (site: string, excerpt: string) => `摘自 ${site}：「${excerpt}」`,
  ourSummary: (summary: string) => `我们的概括：${summary}`,
  notRead: "还没读完，没有算进判断。",
  publishedUnknown: "我们没取到发布日期",

  /** 引用和引用卡（R29）。上一份、下一份、在全部资料里看照原型 c.js（R33 的「在报告里看这份资料」已不对应：资料只在抽屉里列全）。 */
  citeAria: (publishers: string[]) => `查看出处：${publishers.join("、")}`,
  popoverPrev: "上一份",
  popoverNext: "下一份",
  openInDrawer: "在全部资料里看",
  openSite: (site: string) => `打开 ${site} 的原网页`,

  /** 进度页的一句话（I04、I07、I17、I23、I24）。 */
  phaseReading: "先读一遍这句话，看它具体说了什么。",
  phaseSplit: (n: number) => `这句话里有 ${n} 个要点，我们分开查。`,
  phasePartial: (done: number, left: number) => `查完 ${done} 个要点，还剩 ${left} 个。`,
  phaseWriting: (n: number) => `${n} 个要点都查完了，在写结论。`,
  phaseDone: "结论写好了。",

  /**
   * 要点行的状态（I08–I16、I25）。行里已经写着是哪个要点，所以照原型 b.js 用更短的「在找公开资料」；
   * 真实快照不告诉我们正在读哪一份，所以不用 I13「在读《标题》」，改说读几份。
   * 「这个要点这次不查」对应 scope.deferredClaimIds，评审没有覆盖，按准则用词。
   */
  partSearching: "在找公开资料",
  partSearchingFound: (n: number) => `在找公开资料 · 找到 ${n} 份`,
  partReading: (n: number) => `在读找到的 ${n} 份资料`,
  partFoundNotRead: (n: number) => `找到 ${n} 份资料，还没开始读`,
  partJudging: "在对照资料判断",
  partWaiting: (n: number) => `等前面 ${n} 个要点查完`,
  partDeferred: "这个要点这次不查",
  partInterrupted: "没查完",
  /** 药丸上正在读的那一份，立场位先写这两个字（原型 b.js）。 */
  pillReading: "在读",
} as const;

export type ConflictSide = { publisher: string; summary?: string };
