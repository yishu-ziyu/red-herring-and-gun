/**
 * Chrome language for the process desk. Verdict memo stays in the claim's language.
 * Default 中文. Persist in localStorage. Names are native (中文 / English).
 */

export type UiLang = "zh" | "en";

export const UI_LANG_KEY = "rhg.uiLang";

export type UiCopy = {
  runProcess: string;
  thinking: string;
  thoughtDeeply: string;
  search: string;
  searching: string;
  visit: string;
  visiting: string;
  boardCreated: string;
  hideBoard: string;
  viewBoard: string;
  taskBoard: string;
  planning: string;
  checking: string;
  followUp: string;
  followLiveTitle: string;
  followDoneTitle: string;
  send: string;
  sendUnavailable: string;
  disclaimer: string;
  stop: string;
  again: string;
  replay: string;
  change: string;
  langGroup: string;
  todoTitle: string;
  stepsComplete: string;
  stepsUnit: string;
  /* 首页落地层 */
  mission: string;
  outcome: string;
  materialLabel: string;
  materialPlaceholder: string;
  submitStart: string;
  submitScraping: string;
  examplesAria: string;
  examplesLabel: string;
  demoClaims: [string, string, string];
  linksDetected: string;
  fillMaterialFirst: string;
  scrapeFailed: string;
  imageReadFailed: string;
  videoFrameFailed: string;
  videoFrameTooLarge: string;
  tooManyFrames: string;
  imagesOnly: string;
  filesUnsupported: string;
  imagesTooLarge: string;
  tooManyImages: string;
  accountStateLabel: string;
  accountChecking: string;
  signedIn: string;
  signOut: string;
  signInAccount: string;
  pointsPrefix: string;
  addMaterialOrSkill: string;
  addImage: string;
  addAttachment: string;
  skills: string;
  noSkillMatch: string;
  docTitle: string;
  /* 桌面壳层 */
  historyLabel: string;
  newCheck: string;
  recentLabel: string;
  recentEmpty: string;
  statusRunning: string;
  statusInterrupted: string;
  statusDone: string;
  signIn: string;
  accountNavLabel: string;
  accountMenu: string;
  modelSettings: string;
  dossierLabel: string;
  dossierTitle: string;
  collapse: string;
  paperEmpty: string;
  dossierToggle: string;
  dossierCollapse: string;
  references: string;
};

export const UI_COPY: Record<UiLang, UiCopy> = {
  zh: {
    runProcess: "核查过程",
    thinking: "思考中…",
    thoughtDeeply: "深入思考",
    search: "检索网页",
    searching: "正在检索",
    visit: "打开页面",
    visiting: "正在打开",
    boardCreated: "已创建任务板",
    hideBoard: "收起任务板",
    viewBoard: "查看任务板",
    taskBoard: "任务板",
    planning: "正在规划核查路径…",
    checking: "核查进行中",
    followUp: "再问一句…",
    followLiveTitle: "这一轮不能追问。要停下来请点停止。",
    followDoneTitle: "再问一句，继续查这条。要换问题请点再查一条。",
    send: "发送",
    sendUnavailable: "发送不可用",
    disclaimer: "内容由红鲱鱼与枪生成。请自行判断。",
    stop: "停止",
    again: "再查一条",
    replay: "再看一遍",
    change: "换一条",
    langGroup: "界面语言",
    todoTitle: "核查计划",
    stepsComplete: "完成",
    stepsUnit: "步",
    mission: "把你想核查的句子、链接或截图放进来",
    outcome: "告诉你这条说法是否可靠，问题在哪里，来源能点开。",
    materialLabel: "你想核查什么？",
    materialPlaceholder: "一句话、一条链接，或一张截图",
    submitStart: "开始核查",
    submitScraping: "正在抓取链接内容…",
    examplesAria: "试一条",
    examplesLabel: "试试一个未经证实的说法 →",
    demoClaims: [
      "隔夜菜会致癌，等于吃毒药",
      "5G信号塔辐射导致周边居民头晕失眠",
      "人民币即将大幅贬值，赶紧换美元",
    ],
    linksDetected: "检测到的链接",
    fillMaterialFirst: "请先填写待核查材料。",
    scrapeFailed: "链接抓取失败",
    imageReadFailed: "图片读取失败",
    videoFrameFailed: "视频抽帧失败，请换一个短视频文件。",
    videoFrameTooLarge: "视频抽帧后图片总大小超过 6MB，请换更短视频。",
    tooManyFrames: "同一次最多核查 4 张图（视频抽帧也算）。",
    imagesOnly: "当前仅支持图片附件（聊天截图 / 网页截图 / 短视频）。",
    filesUnsupported: "只支持图片和视频文件。",
    imagesTooLarge: "图片总大小不能超过 6MB。",
    tooManyImages: "最多支持 4 张图片附件，超出部分未添加。",
    accountStateLabel: "AI Ping 账号状态",
    accountChecking: "账号检测中",
    signedIn: "已登录",
    signOut: "退出",
    signInAccount: "登录账号",
    pointsPrefix: "点数",
    addMaterialOrSkill: "添加材料或技能",
    addImage: "添加图片",
    addAttachment: "添加附件",
    skills: "技能",
    noSkillMatch: "没有匹配的技能",
    docTitle: "红鲱鱼与枪｜查出处，判断原句哪里站得住",
    historyLabel: "历史卷宗",
    newCheck: "新查一条",
    recentLabel: "最近核查",
    recentEmpty: "还没有查过",
    statusRunning: "核查中",
    statusInterrupted: "没查完",
    statusDone: "已有判断",
    signIn: "登录",
    accountNavLabel: "账号与设置",
    accountMenu: "账户",
    modelSettings: "模型设置",
    dossierLabel: "核查卷宗",
    dossierTitle: "核查卷宗",
    collapse: "收起",
    paperEmpty: "查完的判断会出现在这里。",
    dossierToggle: "卷宗",
    dossierCollapse: "收起卷宗",
    references: "参考资料",
  },
  en: {
    runProcess: "Run process",
    thinking: "thinking…",
    thoughtDeeply: "Thought deeply",
    search: "Search web",
    searching: "Searching web",
    visit: "Visit page",
    visiting: "Visiting page",
    boardCreated: "Task board created",
    hideBoard: "Hide board",
    viewBoard: "View board",
    taskBoard: "Task board",
    planning: "Planning the check…",
    checking: "Checking",
    followUp: "Ask a follow-up…",
    followLiveTitle: "This round cannot take a follow-up. Tap Stop to quit.",
    followDoneTitle: "Ask a follow-up on this claim. Tap Check another for a new one.",
    send: "Send",
    sendUnavailable: "Send unavailable",
    disclaimer: "The content is generated by 红鲱鱼与枪. Critical review is advised.",
    stop: "Stop",
    again: "Check another",
    replay: "Replay",
    change: "New claim",
    langGroup: "Language",
    todoTitle: "Investigation plan",
    stepsComplete: "complete",
    stepsUnit: "steps",
    mission: "Paste it in. Trace the source.",
    outcome: "Tells you which part holds up, where the problems are, with sources you can open.",
    materialLabel: "Material to check",
    materialPlaceholder: "A sentence, a link, or a screenshot",
    submitStart: "Start the check",
    submitScraping: "Fetching the link content…",
    examplesAria: "Try one",
    examplesLabel: "Or try one",
    demoClaims: [
      "Leftover overnight vegetables cause cancer — eating them is like taking poison",
      "Radiation from 5G towers gives nearby residents dizziness and insomnia",
      "The yuan is about to crash — swap it for dollars now",
    ],
    linksDetected: "Links detected",
    fillMaterialFirst: "Add something to check first.",
    scrapeFailed: "Could not fetch the link",
    imageReadFailed: "Could not read the image",
    videoFrameFailed: "Frame extraction failed — try a shorter video clip.",
    videoFrameTooLarge: "Extracted frames exceed 6MB — use a shorter clip.",
    tooManyFrames: "Up to 4 images per check (video frames included).",
    imagesOnly: "Only image attachments are supported (chat / web screenshots, short videos).",
    filesUnsupported: "Only image and video files are supported.",
    imagesTooLarge: "Total image size must stay under 6MB.",
    tooManyImages: "Up to 4 image attachments — extras were dropped.",
    accountStateLabel: "AI Ping account status",
    accountChecking: "Checking account",
    signedIn: "Signed in",
    signOut: "Sign out",
    signInAccount: "Sign in",
    pointsPrefix: "Points",
    addMaterialOrSkill: "Add material or a skill",
    addImage: "Add image",
    addAttachment: "Add attachment",
    skills: "Skills",
    noSkillMatch: "No matching skills",
    docTitle: "Red Herring & Gun | Trace the source, judge what holds up",
    historyLabel: "Past cases",
    newCheck: "New check",
    recentLabel: "Recent checks",
    recentEmpty: "Nothing checked yet",
    statusRunning: "Checking",
    statusInterrupted: "Interrupted",
    statusDone: "Verdict ready",
    signIn: "Sign in",
    accountNavLabel: "Account & settings",
    accountMenu: "Account",
    modelSettings: "Model settings",
    dossierLabel: "Case file",
    dossierTitle: "Case file",
    collapse: "Collapse",
    paperEmpty: "The verdict will appear here once the check is done.",
    dossierToggle: "File",
    dossierCollapse: "Hide file",
    references: "References",
  },
};

const listeners = new Set<() => void>();

function asLang(value: string | null | undefined): UiLang | null {
  if (value === "zh" || value === "en") return value;
  return null;
}

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return "zh";
  const stored = asLang(window.localStorage.getItem(UI_LANG_KEY));
  if (stored) return stored;
  return asLang(new URLSearchParams(window.location.search).get("lang")) ?? "zh";
}

export function applyUiLang(lang: UiLang): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = UI_COPY[lang].docTitle;
  }
}

export function setUiLang(lang: UiLang): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(UI_LANG_KEY, lang);
  }
  applyUiLang(lang);
  listeners.forEach((fn) => fn());
}

export function subscribeUiLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function processStepLabel(
  step: { kind: string; status: string; ticker?: boolean },
  copy: UiCopy
): string {
  if (step.kind === "thought") {
    return step.ticker && step.status === "loading" ? copy.thinking : copy.thoughtDeeply;
  }
  if (step.kind === "board") return copy.boardCreated;
  if (step.kind === "search") return step.status === "loading" ? copy.searching : copy.search;
  if (step.kind === "visit") return step.status === "loading" ? copy.visiting : copy.visit;
  return copy.runProcess;
}

export function stopChromeLabel(
  live: boolean,
  stopLabel: string | undefined,
  copy: UiCopy
): string {
  if (live) {
    if (stopLabel === "换一条") return copy.change;
    return copy.stop;
  }
  if (stopLabel === "再看一遍") return copy.replay;
  if (stopLabel === "换一条") return copy.change;
  if (stopLabel && stopLabel !== "停止" && stopLabel !== "再查一条") return stopLabel;
  return copy.again;
}
