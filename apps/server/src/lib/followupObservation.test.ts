/**
 * 追问观测分类器验收（契约 docs/evals/2026-09-12-followup-observation.md）。
 *
 * 覆盖分类器四情形：same + 无新源 → candidate、有新源 → 非 candidate、
 * 判词 changed → 非 candidate、上一轮缺失 → null；外加判词阶梯、hostname 规范化、
 * 落盘一行且不含原句文本。
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FOLLOW_UP_OBSERVATION_FILE,
  UNKNOWN_VERDICT,
  appendFollowUpObservation,
  buildFollowUpObservation,
  followUpObservationPath,
  sourceHostsOf,
  verdictDeltaOf,
  type FollowUpObservation,
} from "./followupObservation.js";

const STATS = { atomsTotal: 3, atomsSearched: 2, atomsUnverified: 1, searchesTotal: 4 };

function report(verdictType: unknown, urls: string[], extra: Record<string, unknown> = {}) {
  return {
    verdictType,
    citationSources: urls.map((url) => ({ url, title: "标题" })),
    ...extra,
  };
}

function build(priorReport: unknown, current: unknown) {
  return buildFollowUpObservation({
    priorReport,
    report: current,
    stats: STATS,
    runId: "run-1",
    caseId: "case-new",
    priorCaseId: "case-prior",
  });
}

function readLines(dir: string): string[] {
  return readFileSync(join(dir, FOLLOW_UP_OBSERVATION_FILE), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

let dataDirPath = "";
beforeEach(() => {
  dataDirPath = mkdtempSync(join(tmpdir(), "rhg-followup-"));
  process.env.DATA_DIR = dataDirPath;
});

describe("buildFollowUpObservation — 分类四情形", () => {
  it("判词 same 且无新来源 → fastPathCandidate=true", () => {
    const built = build(
      report("true", ["https://www.example.com/a"]),
      report("true", ["https://EXAMPLE.com/b"])
    );
    expect(built).not.toBeNull();
    expect(built!.priorVerdict).toBe("true");
    expect(built!.verdict).toBe("true");
    expect(built!.verdictDelta).toBe("same");
    expect(built!.priorSourceCount).toBe(1);
    expect(built!.overlapSourceCount).toBe(1);
    expect(built!.newSourceCount).toBe(0);
    expect(built!.fastPathCandidate).toBe(true);
    // 计数原样透传，不被分类器改写
    expect(built!.atomsTotal).toBe(3);
    expect(built!.atomsSearched).toBe(2);
    expect(built!.atomsUnverified).toBe(1);
    expect(built!.searchesTotal).toBe(4);
  });

  it("判词 same 但有新来源 → fastPathCandidate=false", () => {
    const built = build(
      report("mixed_misleading", ["https://a.test/1", "https://b.test/1"]),
      report("mixed_misleading", ["https://b.test/2", "https://c.test/1"])
    );
    expect(built!.priorSourceCount).toBe(2);
    expect(built!.overlapSourceCount).toBe(1);
    expect(built!.newSourceCount).toBe(1);
    expect(built!.verdictDelta).toBe("same");
    expect(built!.fastPathCandidate).toBe(false);
  });

  it("判词变了 → 非 candidate（且方向写在 verdictDelta 上）", () => {
    const strengthened = build(report("false", []), report("true", []));
    expect(strengthened!.verdictDelta).toBe("strengthened");
    expect(strengthened!.fastPathCandidate).toBe(false);

    const weakened = build(report("true", []), report("mixed_misleading", []));
    expect(weakened!.verdictDelta).toBe("weakened");
    expect(weakened!.fastPathCandidate).toBe(false);
  });

  it("上一轮报告缺失 / 不可读 → null（不写记录）", () => {
    expect(build(undefined, report("true", ["https://a.test/1"]))).toBeNull();
    expect(build(null, report("true", ["https://a.test/1"]))).toBeNull();
    expect(build("这不是报告", report("true", ["https://a.test/1"]))).toBeNull();
    expect(build(report("true", []), undefined)).toBeNull();
  });

  it("两轮判词与来源都取不到 → null；只有判词取不到时照写 unknown", () => {
    expect(build({}, {})).toBeNull();
    const halfReadable = build({}, report("true", ["https://a.test/1"]));
    expect(halfReadable).not.toBeNull();
    expect(halfReadable!.priorVerdict).toBe(UNKNOWN_VERDICT);
    expect(halfReadable!.verdictDelta).toBe("changed");
    expect(halfReadable!.fastPathCandidate).toBe(false);
    expect(halfReadable!.priorSourceCount).toBe(0);
    expect(halfReadable!.newSourceCount).toBe(1);
  });

  it("判词两侧都取不到 → unknown，且绝不判成 same", () => {
    const built = build(report(undefined, ["https://a.test/1"]), report("  ", ["https://a.test/1"]));
    expect(built!.priorVerdict).toBe(UNKNOWN_VERDICT);
    expect(built!.verdict).toBe(UNKNOWN_VERDICT);
    expect(built!.verdictDelta).not.toBe("same");
    expect(built!.fastPathCandidate).toBe(false);
  });
});

describe("verdictDeltaOf — 确定性阶梯", () => {
  it("同判词 same；阶梯上移 strengthened、下移 weakened", () => {
    expect(verdictDeltaOf("true", "true")).toBe("same");
    expect(verdictDeltaOf("false", "unverified")).toBe("strengthened");
    expect(verdictDeltaOf("unverified", "mixed_misleading")).toBe("strengthened");
    expect(verdictDeltaOf("mixed_misleading", "true")).toBe("strengthened");
    expect(verdictDeltaOf("true", "false")).toBe("weakened");
    expect(verdictDeltaOf("mixed_misleading", "unverified")).toBe("weakened");
  });

  it("任一侧 unknown（或不在阶梯上）→ changed", () => {
    expect(verdictDeltaOf("unknown", "true")).toBe("changed");
    expect(verdictDeltaOf("true", "unknown")).toBe("changed");
    expect(verdictDeltaOf("unknown", "unknown")).toBe("changed");
    expect(verdictDeltaOf("某种新判词", "true")).toBe("changed");
  });
});

describe("sourceHostsOf — 报告引用条目的规范化 hostname", () => {
  it("小写、去 www.、去端口、去重；非 http(s) 与不可解析的 URL 不计", () => {
    const hosts = sourceHostsOf({
      subclaimVerdicts: [
        {
          supportingSources: [{ url: "https://WWW.Example.COM:8443/a" }, { url: "https://example.com/b" }],
          contradictingSources: [{ url: "http://news.test.cn/x" }],
        },
      ],
      citationSources: [
        { url: "https://www.news.test.cn/y" },
        { url: "不是 URL" },
        { url: "ftp://files.test/z" },
        { url: "mailto:someone@example.com" },
      ],
    });
    expect([...hosts].sort()).toEqual(["example.com", "news.test.cn"]);
  });

  it("非对象 / 缺字段时不炸，返回空集", () => {
    expect(sourceHostsOf(undefined).size).toBe(0);
    expect(sourceHostsOf({ citationSources: "不是数组" }).size).toBe(0);
    expect(sourceHostsOf({ citationSources: [null, 3, { url: 7 }] }).size).toBe(0);
  });
});

describe("appendFollowUpObservation — 一行 JSON，不带原句文本", () => {
  const record = {
    runId: "run-1",
    caseId: "case-new",
    priorCaseId: "case-prior",
    atomsTotal: 3,
    atomsSearched: 2,
    atomsUnverified: 1,
    searchesTotal: 4,
    priorSourceCount: 1,
    overlapSourceCount: 1,
    newSourceCount: 0,
    priorVerdict: "true",
    verdict: "true",
    verdictDelta: "same" as const,
    fastPathCandidate: true,
  };

  it("写入 DATA_DIR/followup-observations.jsonl，字段齐全、ts 自动生成", () => {
    const claimText = "隔夜菜里的亚硝酸盐会致癌";
    // 故意多塞一个 claim 字段：append 只写契约那 15 个字段，多的键一律丢掉。
    appendFollowUpObservation({ ...record, claim: claimText } as typeof record);
    appendFollowUpObservation({ ...record, ts: "2026-09-12T00:00:00.000Z" });

    const lines = readLines(dataDirPath);
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as FollowUpObservation;
    expect(Object.keys(first)).toEqual([
      "ts",
      "runId",
      "caseId",
      "priorCaseId",
      "atomsTotal",
      "atomsSearched",
      "atomsUnverified",
      "searchesTotal",
      "priorSourceCount",
      "overlapSourceCount",
      "newSourceCount",
      "priorVerdict",
      "verdict",
      "verdictDelta",
      "fastPathCandidate",
    ]);
    expect(first.runId).toBe("run-1");
    expect(first.caseId).toBe("case-new");
    expect(first.priorCaseId).toBe("case-prior");
    expect(first.fastPathCandidate).toBe(true);
    expect(Number.isNaN(Date.parse(first.ts))).toBe(false);
    expect((JSON.parse(lines[1]!) as FollowUpObservation).ts).toBe("2026-09-12T00:00:00.000Z");
    // 隐私：原句文本不得落进文件
    expect(readFileSync(followUpObservationPath(dataDirPath), "utf8")).not.toContain(claimText);
  });

  it("身份缺失 → 抛错，不写半条记录", () => {
    expect(() => appendFollowUpObservation({ ...record, runId: "" })).toThrow();
    expect(() => appendFollowUpObservation({ ...record, priorCaseId: "" })).toThrow();
    expect(() => appendFollowUpObservation({ ...record, caseId: "" })).toThrow();
  });
});
