/**
 * 旧 cases.json → SQLite 的迁移验收（docs/evals/2026-09-11-run-service.md D1–D4）。
 *
 * 关键：迁移必须幂等、先备份、不伪造时间、不截断条数。用真文件跑，不打桩。
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function legacyEntry(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "aaaa0001",
    claim: "微波炉加热食物会致癌",
    report: { originalClaim: "微波炉加热食物会致癌", overallStatus: "原句过强" },
    claimReview: { "@type": "ClaimReview", claimReviewed: "微波炉加热食物会致癌" },
    credibilityScore: 42,
    createdAt: 1_700_000_000_000,
    ownerHash: "owner-a",
    ...overrides,
  };
}

let dataDirPath = "";

async function freshStore(legacy: unknown[] | null) {
  vi.resetModules();
  process.env.DATA_DIR = dataDirPath;
  process.env.RHG_DB_FILE = join(dataDirPath, "rhg.sqlite");
  if (legacy) writeFileSync(join(dataDirPath, "cases.json"), JSON.stringify(legacy));
  return import("./caseStore.js");
}

beforeEach(() => {
  dataDirPath = mkdtempSync(join(tmpdir(), "rhg-migration-"));
});

describe("旧 cases.json 迁移", () => {
  it("D1 逐字段保留，且导入两次不增行", async () => {
    const legacy = [legacyEntry(), legacyEntry({ caseId: "bbbb0002", claim: "第二条", ownerHash: "owner-b" })];
    const store = await freshStore(legacy);
    expect(store.isUsingMemory()).toBe(false);
    expect(store.caseCount()).toBe(2);

    const first = store.getCase("aaaa0001")!;
    expect(first.claim).toBe("微波炉加热食物会致癌");
    expect(first.ownerHash).toBe("owner-a");
    expect(first.createdAt).toBe(1_700_000_000_000);
    expect(first.credibilityScore).toBe(42);
    expect((first.report as { overallStatus: string }).overallStatus).toBe("原句过强");

    // 幂等：清掉进程内实例重新打开同一个库，不再导入
    store.__resetStoreForTests();
    const again = await freshStore(null);
    expect(again.caseCount()).toBe(2);

    // 再写一条也不影响旧记录
    again.putCase({
      claim: "新的一条",
      report: { originalClaim: "新" } as never,
      claimReview: {} as never,
      credibilityScore: 1,
    });
    expect(again.caseCount()).toBe(3);
  });

  it("D2 先备份原件，备份内容与原件一致", async () => {
    const legacy = [legacyEntry()];
    const store = await freshStore(legacy);
    store.caseCount();
    const files = readdirSync(dataDirPath);
    const backup = files.find((name) => name.startsWith("cases.json.bak-"));
    expect(backup).toBeTruthy();
    expect(readFileSync(join(dataDirPath, backup!), "utf8")).toBe(
      readFileSync(join(dataDirPath, "cases.json"), "utf8")
    );
  });

  it("D3 没有 createdAt 的旧记录保持未知，不拿当前时间填充", async () => {
    const legacy = [legacyEntry({ caseId: "noc00001", createdAt: undefined })];
    const store = await freshStore(legacy);
    const entry = store.getCase("noc00001")!;
    expect(entry.createdAt).toBe(0);
    expect(entry.createdAtUnknown).toBe(true);
    expect(entry.createdAt).not.toBeGreaterThan(1_700_000_000_000);
  });

  it("D4 超过 1000 条的旧记录不被截断", async () => {
    const legacy = Array.from({ length: 1205 }, (_, index) =>
      legacyEntry({ caseId: `case${String(index).padStart(4, "0")}`, claim: `第 ${index} 条`, createdAt: 1_700_000_000_000 + index })
    );
    const store = await freshStore(legacy);
    expect(store.caseCount()).toBe(1205);
    expect(store.getCase("case0000")).not.toBeNull();
    expect(store.getCase("case1204")).not.toBeNull();
  });

  it("坏条目跳过，不阻断整次导入", async () => {
    const legacy = [legacyEntry(), { caseId: "" }, null, { claim: "没有 id" }, legacyEntry({ caseId: "good0002" })];
    const store = await freshStore(legacy as unknown[]);
    expect(store.caseCount()).toBe(2);
  });

  it("没有旧文件时不建备份、不报错", async () => {
    const store = await freshStore(null);
    store.caseCount();
    expect(readdirSync(dataDirPath).some((name) => name.startsWith("cases.json.bak-"))).toBe(false);
  });
});
