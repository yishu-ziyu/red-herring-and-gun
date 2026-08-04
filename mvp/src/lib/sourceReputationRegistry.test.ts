/**
 * sourceReputationRegistry.test.ts — Plan P1-4 · 第 5 维来源历史信誉
 *
 * 闸门不变量（plan §4）：
 *   - 未知源必须返回 unrated
 *   - round-trip 持久化
 *   - LRU 淘汰正确
 *   - **不进入** computeCredibilityScore 公式（仅展示信号）
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getReputationScore,
  loadReputationStore,
  recordOutcome,
  resetReputationStore,
} from "./sourceReputationRegistry";

let tmpDir: string;
let tmpPath: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gun-rep-"));
  tmpPath = path.join(tmpDir, "sourceReputation.json");
});
afterEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
});

describe("Plan P1-4 · sourceReputationRegistry", () => {
  it("未知源必须返回 unrated（禁止默认 45 冒充历史记录）", () => {
    const out = getReputationScore("unknown-domain.com", { storePathOverride: tmpPath });
    expect(out.label).toBe("unrated");
    expect(out.entry).toBeNull();
  });

  it("recordOutcome 写入后 getReputationScore 应能读到", () => {
    recordOutcome("example.com", "positive", { storePathOverride: tmpPath });
    const out = getReputationScore("example.com", { storePathOverride: tmpPath });
    expect(out.entry).not.toBeNull();
    expect(out.entry!.positive).toBe(1);
  });

  it("hostname 标准化：去 www. / 小写", () => {
    recordOutcome("WWW.Example.COM", "positive", { storePathOverride: tmpPath });
    expect(getReputationScore("example.com", { storePathOverride: tmpPath }).entry).not.toBeNull();
    expect(getReputationScore("www.example.com", { storePathOverride: tmpPath }).entry).not.toBeNull();
  });

  it("label 阈值：≥60% positive + ≥3 条 → positive", () => {
    recordOutcome("good.com", "positive", { storePathOverride: tmpPath });
    recordOutcome("good.com", "positive", { storePathOverride: tmpPath });
    recordOutcome("good.com", "positive", { storePathOverride: tmpPath });
    recordOutcome("good.com", "mixed", { storePathOverride: tmpPath });
    expect(getReputationScore("good.com", { storePathOverride: tmpPath }).label).toBe("positive");
  });

  it("label 阈值：≥50% negative + ≥2 条 → negative", () => {
    recordOutcome("bad.com", "negative", { storePathOverride: tmpPath });
    recordOutcome("bad.com", "negative", { storePathOverride: tmpPath });
    recordOutcome("bad.com", "positive", { storePathOverride: tmpPath });
    expect(getReputationScore("bad.com", { storePathOverride: tmpPath }).label).toBe("negative");
  });

  it("label：混合记录 → mixed", () => {
    recordOutcome("mixed.com", "positive", { storePathOverride: tmpPath });
    recordOutcome("mixed.com", "negative", { storePathOverride: tmpPath });
    expect(getReputationScore("mixed.com", { storePathOverride: tmpPath }).label).toBe("mixed");
  });

  it("round-trip 持久化（写一次再 load 必须一致）", () => {
    recordOutcome("persist.com", "positive", { storePathOverride: tmpPath });
    const snapshot = loadReputationStore();
    // 直接读 tmpPath 文件而不是 loadReputationStore（后者读 ~/.gun）
    const raw = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.entries.length).toBe(1);
    expect(raw.entries[0].hostname).toBe("persist.com");
    expect(raw.entries[0].positive).toBe(1);
    // 防御：loadReputationStore 不会读到 tmpPath，但 snapshot 引用应至少有 entries 数组结构
    expect(Array.isArray(snapshot.entries)).toBe(true);
  });

  it("LRU 淘汰：超过 lruLimit 时按 lastUpdated 保留最近 N 条", () => {
    for (let i = 0; i < 5; i++) {
      recordOutcome(`host${i}.com`, "positive", {
        storePathOverride: tmpPath,
        lruLimit: 3,
      });
    }
    const raw = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
    expect(raw.entries.length).toBe(3);
    // 最新写入的应该是 host4（按顺序 2-3-4）
    const hosts = raw.entries.map((e: { hostname: string }) => e.hostname).sort();
    expect(hosts).toContain("host4.com");
  });

  it("resetReputationStore 应清空本地存储", () => {
    recordOutcome("foo.com", "positive", { storePathOverride: tmpPath });
    expect(fs.existsSync(tmpPath)).toBe(true);
    resetReputationStore({ storePathOverride: tmpPath });
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it("不污染用户 ~/.gun/ 目录：使用 override 路径时不写默认位置", () => {
    const userPath = path.join(os.homedir(), ".gun", "sourceReputation.json");
    const beforeExists = fs.existsSync(userPath);
    recordOutcome("test.com", "positive", { storePathOverride: tmpPath });
    const afterExists = fs.existsSync(userPath);
    expect(afterExists).toBe(beforeExists); // 没有副作用
  });

  it("空 hostname 不应写入记录（早返回，不创建文件）", () => {
    recordOutcome("", "positive", { storePathOverride: tmpPath });
    // 早返回：未写入任何文件
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});