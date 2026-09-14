/**
 * knowledgeMatch（Part 1 · 数据/匹配层）：规范化、日期、确定性匹配与分类。
 * 契约 docs/evals/2026-09-12-evidence-base.md。
 */
import { describe, expect, it } from "vitest";
import {
  ageDaysOf,
  classifyKnowledgeMatch,
  hasSubjectMismatch,
  hasTokenConflict,
  isKnowledgeVerdictInjectable,
  KNOWLEDGE_MATCH_THRESHOLD,
  KNOWLEDGE_MAX_AGE_DAYS,
  normalizeKnowledgeAtom,
  originDateOf,
  type KnowledgeMatchEntry,
} from "./knowledgeMatch";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-13T00:00:00.000Z");

function entry(over: Partial<KnowledgeMatchEntry> = {}): KnowledgeMatchEntry {
  return {
    id: "k1",
    atomNorm: "隔夜菜的亚硝酸盐含量会超标",
    verdict: "false",
    evidence: [{ url: "https://news.example/nitrite" }],
    lastVerifiedAt: NOW - DAY,
    ...over,
  };
}

describe("normalizeKnowledgeAtom", () => {
  it("trim、压缩空白、全角与大小写统一、去句末标点", () => {
    expect(normalizeKnowledgeAtom("  隔夜菜  亚硝酸盐超标 。 ")).toBe("隔夜菜 亚硝酸盐超标");
    expect(normalizeKnowledgeAtom("ＡＢＣ　ＤＥＦ")).toBe("abc def");
    expect(normalizeKnowledgeAtom("超标！！！")).toBe("超标");
    // NFKC 把全角逗号也统一成半角（全半角统一的一部分）
    expect(normalizeKnowledgeAtom("放一晚，会中毒；")).toBe("放一晚,会中毒");
    expect(normalizeKnowledgeAtom("")).toBe("");
    expect(normalizeKnowledgeAtom("。。。")).toBe("");
    // 只压空白不去空白：词间空格保留，避免把两个词粘成一个
    expect(normalizeKnowledgeAtom(" 隔夜菜  超标 ")).toBe("隔夜菜 超标");
  });

  it("相同命题的不同写法归一到同一个键", () => {
    expect(normalizeKnowledgeAtom("隔夜菜超标。")).toBe(normalizeKnowledgeAtom("隔夜菜超标"));
    expect(normalizeKnowledgeAtom("隔夜菜超标！")).toBe(normalizeKnowledgeAtom("隔夜菜超标"));
    expect(normalizeKnowledgeAtom("APP")).toBe(normalizeKnowledgeAtom("app"));
  });
});

describe("originDateOf / ageDaysOf", () => {
  it("epoch ms → YYYY-MM-DD；取不到返回空串，不编日期", () => {
    expect(originDateOf(Date.parse("2026-09-11T03:20:00.000Z"))).toBe("2026-09-11");
    expect(originDateOf(0)).toBe("");
    expect(originDateOf(undefined)).toBe("");
    expect(originDateOf(Number.NaN)).toBe("");
  });

  it("距今整天数向下取整，非法时间视为不可用", () => {
    expect(ageDaysOf(NOW - DAY, NOW)).toBe(1);
    expect(ageDaysOf(NOW - DAY / 2, NOW)).toBe(0);
    expect(ageDaysOf(NOW + DAY, NOW)).toBe(0);
    expect(ageDaysOf(0, NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("hasTokenConflict（不静默继承的确定性闸门）", () => {
  it("日期/年份/编号换了 → 冲突", () => {
    expect(hasTokenConflict("2026年3月5日某地地铁停运", "2026年3月6日某地地铁停运")).toBe(true);
    expect(hasTokenConflict("第8号台风登陆", "第9号台风登陆")).toBe(true);
  });

  it("链接换了 → 冲突", () => {
    expect(
      hasTokenConflict(
        "微博 https://weibo.example/A 说有补贴",
        "微博 https://weibo.example/B 说有补贴"
      )
    ).toBe(true);
  });

  it("只有一侧带数字/链接 → 不算冲突（正常改写）", () => {
    expect(hasTokenConflict("隔夜菜放8小时亚硝酸盐升高", "隔夜菜亚硝酸盐升高")).toBe(false);
    expect(hasTokenConflict("隔夜菜亚硝酸盐升高", "隔夜菜亚硝酸盐升高 https://a.example/x")).toBe(false);
  });

  it("完全同文 / 纯汉字改写 → 不冲突", () => {
    expect(hasTokenConflict("隔夜菜超标", "隔夜菜超标")).toBe(false);
    expect(hasTokenConflict("吃了隔夜菜会导致中毒", "吃剩菜会不会食物中毒")).toBe(false);
  });
});

describe("classifyKnowledgeMatch", () => {
  it("同一条命题（逐字相同）→ injectable", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜的亚硝酸盐含量会超标。",
      entries: [entry()],
      now: NOW,
    });
    expect(out.kind).toBe("injectable");
    if (out.kind === "injectable") {
      expect(out.score).toBeGreaterThanOrEqual(95);
      expect(out.ageDays).toBe(1);
    }
  });

  it("真实改写变体（字面不同、语义相同）→ injectable", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜放一晚亚硝酸盐会升高",
      entries: [entry({ atomNorm: "隔夜菜的亚硝酸盐含量会超标（超出食品安全标准限值）" })],
      now: NOW,
    });
    expect(out.kind).toBe("injectable");
    if (out.kind === "injectable") expect(out.score).toBeGreaterThanOrEqual(KNOWLEDGE_MATCH_THRESHOLD);
  });

  it("无关说法 → none（零变化）", () => {
    const out = classifyKnowledgeMatch({
      atom: "电动车失窃后被送往国外",
      entries: [entry()],
      now: NOW,
    });
    expect(out.kind).toBe("none");
  });

  it("只共享「致癌」的跨案命题不得注入（微波炉追问 ≠ 剩饭剩菜）", () => {
    const leftover = entry({ atomNorm: "吃剩饭剩菜会致癌" });
    const microwave = classifyKnowledgeMatch({
      atom: "IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估",
      entries: [leftover],
      now: NOW,
    });
    const epi = classifyKnowledgeMatch({
      atom: "这一说法在流行病学或临床医学中是否有可靠的实验数据支持",
      entries: [leftover],
      now: NOW,
    });
    expect(hasSubjectMismatch("IARC对微波辐射的致癌性有专项评估", "吃剩饭剩菜会致癌")).toBe(true);
    expect(microwave.kind).toBe("none");
    expect(epi.kind).toBe("none");
  });

  it("日期换了 → 匹配不上（不静默继承）", () => {
    const out = classifyKnowledgeMatch({
      atom: "2026年3月6日某地地铁发生故障",
      entries: [entry({ atomNorm: "2026年3月5日某地地铁发生故障" })],
      now: NOW,
    });
    expect(out.kind).toBe("none");
  });

  it("超龄（>30 天）→ stale，不注入", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜的亚硝酸盐含量会超标",
      entries: [entry({ lastVerifiedAt: NOW - (KNOWLEDGE_MAX_AGE_DAYS + 1) * DAY })],
      now: NOW,
    });
    expect(out.kind).toBe("stale");
    if (out.kind === "stale") expect(out.ageDays).toBe(KNOWLEDGE_MAX_AGE_DAYS + 1);
  });

  it("第 30 天仍新鲜（窗口含端点）", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜的亚硝酸盐含量会超标",
      entries: [entry({ lastVerifiedAt: NOW - KNOWLEDGE_MAX_AGE_DAYS * DAY })],
      now: NOW,
    });
    expect(out.kind).toBe("injectable");
  });

  it("判词 unverified → unusable（按未命中处理）", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜的亚硝酸盐含量会超标",
      entries: [entry({ verdict: "unverified" })],
      now: NOW,
    });
    expect(out.kind).toBe("unusable");
  });

  it("条目没有可注入的真实 URL → unusable", () => {
    const out = classifyKnowledgeMatch({
      atom: "隔夜菜的亚硝酸盐含量会超标",
      entries: [entry({ evidence: [] })],
      now: NOW,
    });
    expect(out.kind).toBe("unusable");
  });

  it("同分并列取更近的一条，保证确定性", () => {
    const older = entry({ id: "old", lastVerifiedAt: NOW - 10 * DAY });
    const newer = entry({ id: "new", lastVerifiedAt: NOW - DAY });
    const a = classifyKnowledgeMatch({ atom: "隔夜菜的亚硝酸盐含量会超标", entries: [older, newer], now: NOW });
    const b = classifyKnowledgeMatch({ atom: "隔夜菜的亚硝酸盐含量会超标", entries: [newer, older], now: NOW });
    expect(a.kind).toBe("injectable");
    expect(b.kind).toBe("injectable");
    if (a.kind === "injectable" && b.kind === "injectable") {
      expect(a.entry.id).toBe("new");
      expect(b.entry.id).toBe("new");
    }
  });
});

describe("isKnowledgeVerdictInjectable", () => {
  it("只放行 true / false / mixed_misleading", () => {
    expect(isKnowledgeVerdictInjectable("true")).toBe(true);
    expect(isKnowledgeVerdictInjectable("FALSE")).toBe(true);
    expect(isKnowledgeVerdictInjectable("mixed_misleading")).toBe(true);
    expect(isKnowledgeVerdictInjectable("unverified")).toBe(false);
    expect(isKnowledgeVerdictInjectable("partial")).toBe(false);
    expect(isKnowledgeVerdictInjectable(undefined)).toBe(false);
  });
});
