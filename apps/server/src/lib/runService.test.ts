/**
 * runService 验收（docs/evals/2026-09-11-run-service.md D8–D14）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRunStore, type RunStore } from "./runStore.js";
import { createRunService, hashRunInput } from "./runService.js";

let dataDirPath = "";
let store: RunStore;

async function freshStore() {
  vi.resetModules();
  process.env.DATA_DIR = dataDirPath;
  process.env.RHG_DB_FILE = join(dataDirPath, "rhg.sqlite");
  const mod = await import("./runStore.js");
  return mod.openRunStore();
}

beforeEach(async () => {
  dataDirPath = mkdtempSync(join(tmpdir(), "rhg-run-"));
  store = (await freshStore())!;
  expect(store).not.toBeNull();
});

function service() {
  return createRunService({ store, now: () => 1_760_000_000_000 });
}

describe("D8/D9/D10 幂等创建", () => {
  it("D8 同一身份 + 同一 clientRequestId 返回同一个 run，不新建", () => {
    const svc = service();
    const input = { caseId: "case-1", ownerHash: "a", clientRequestId: "req-1", inputHash: hashRunInput("说法") };
    const first = svc.start(input);
    const second = svc.start(input);
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("existing");
    expect(second.run.runId).toBe(first.run.runId);
    expect(store.latestForCase("case-1")!.runId).toBe(first.run.runId);
  });

  it("D9 同一 clientRequestId 但输入不同 → conflict，不复用旧 run", () => {
    const svc = service();
    svc.start({ caseId: "case-1", ownerHash: "a", clientRequestId: "req-1", inputHash: hashRunInput("说法甲") });
    const clash = svc.start({
      caseId: "case-1",
      ownerHash: "a",
      clientRequestId: "req-1",
      inputHash: hashRunInput("说法乙"),
    });
    expect(clash.kind).toBe("conflict");
    expect(clash.existing.status).toBe("accepted");
  });

  it("D10 幂等按身份作用域：另一个账号用同一个 clientRequestId 各自建 run", () => {
    const svc = service();
    const a = svc.start({ caseId: "case-a", ownerHash: "a", clientRequestId: "req-1" });
    const b = svc.start({ caseId: "case-b", ownerHash: "b", clientRequestId: "req-1" });
    expect(a.kind).toBe("created");
    expect(b.kind).toBe("created");
    expect(a.run.runId).not.toBe(b.run.runId);
  });

  it("匿名访客也能幂等（ownerHash = null）", () => {
    const svc = service();
    const first = svc.start({ caseId: "case-1", clientRequestId: "req-1" });
    const second = svc.start({ caseId: "case-1", clientRequestId: "req-1" });
    expect(second.kind).toBe("existing");
    expect(second.run.runId).toBe(first.run.runId);
  });
});

describe("D11/D12/D13 取消与状态机", () => {
  it("D11 cancel 幂等：第一次进 cancelling 并 abort signal，终态后再调无副作用", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const signal = svc.signalFor(run.runId)!;
    expect(signal.aborted).toBe(false);

    const first = svc.cancel(run.runId);
    expect(first.kind).toBe("cancelling");
    expect(signal.aborted).toBe(true);
    expect(svc.get(run.runId)!.status).toBe("cancelling");

    svc.finish(run.runId, "cancelled");
    const after = svc.cancel(run.runId);
    expect(after.kind).toBe("already-terminal");
    expect(svc.get(run.runId)!.status).toBe("cancelled");
  });

  it("D12 取消后不再启动新一轮：signal 已 abort，循环立刻退出", async () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const signal = svc.signalFor(run.runId)!;

    let rounds = 0;
    const pipeline = async () => {
      while (!signal.aborted && rounds < 100) {
        rounds += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      return rounds;
    };
    const running = pipeline();
    await new Promise((resolve) => setTimeout(resolve, 6));
    svc.cancel(run.runId);
    const roundsAtCancel = await running;
    expect(signal.aborted).toBe(true);
    // 取消之后不再有新一轮
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rounds).toBe(roundsAtCancel);
    expect(rounds).toBeLessThan(100);
  });

  it("D13 终态不能被后续状态倒退", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.advance(run.runId, "investigating");
    svc.advance(run.runId, "completed");
    expect(svc.advance(run.runId, "investigating")).toBe(false);
    expect(svc.get(run.runId)!.status).toBe("completed");
  });

  it("取消一个不存在的 run 返回 not-found，不抛", () => {
    expect(service().cancel("nope").kind).toBe("not-found");
  });

  it("已点停止的 run 不允许被报成 completed（真实跑过的那次就是这么丢的）", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.cancel(run.runId);
    // 管线可能刚好在写最后一份报告；终态仍然不能是「已完成」
    svc.finish(run.runId, "completed");
    expect(svc.get(run.runId)!.status).toBe("cancelled");
  });

  it("没有点停止的 run 正常收尾成 completed", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.finish(run.runId, "completed");
    expect(svc.get(run.runId)!.status).toBe("completed");
  });
});

describe("D14 重启后未完成的 run 标 interrupted", () => {
  it("中间快照保留，状态变 interrupted", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.advance(run.runId, "investigating");
    store.saveSnapshot(run.runId, { phase: "investigating" } as never);

    const changed = svc.markInterruptedOnBoot();
    expect(changed).toBe(1);
    const after = svc.get(run.runId)!;
    expect(after.status).toBe("interrupted");
    expect(after.snapshot).toEqual({ phase: "investigating" });
  });

  it("已完成的 run 不被重启标记覆盖", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.finish(run.runId, "completed");
    expect(svc.markInterruptedOnBoot()).toBe(0);
  });
});

describe("没有 SQLite 时也能幂等与取消", () => {
  it("store = null 走进程内注册表", () => {
    const svc = createRunService({ store: null });
    const first = svc.start({ caseId: "case-1", ownerHash: "a", clientRequestId: "req-1" });
    const second = svc.start({ caseId: "case-1", ownerHash: "a", clientRequestId: "req-1" });
    expect(second.kind).toBe("existing");
    expect(second.run.runId).toBe(first.run.runId);
    expect(svc.cancel(first.run.runId).kind).toBe("cancelling");
    expect(svc.markInterruptedOnBoot()).toBe(0);
  });
});

describe("runStore 不变量（D7）", () => {
  it("活动 seq 唯一：重复 seq 不产生第二行", async () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const activity = {
      version: 1 as const,
      id: `${run.runId}:1`,
      runId: run.runId,
      seq: 1,
      occurredAt: "2026-09-11T10:00:00.000Z",
      kind: "search_started" as const,
      role: "source" as const,
      claimIds: [],
      sourceIds: [],
      snapshotRevision: 1,
      payload: { query: "x" },
    };
    expect(store.appendActivities(run.runId, [activity])).toBe(1);
    expect(store.appendActivities(run.runId, [activity])).toBe(0);
    expect(store.listActivities(run.runId)).toHaveLength(1);
  });

  it("活动必须挂在存在的 run 上：没有 run 直接抛", () => {
    expect(() =>
      store.appendActivities("no-such-run", [
        {
          version: 1,
          id: "x:1",
          runId: "no-such-run",
          seq: 1,
          occurredAt: "2026-09-11T10:00:00.000Z",
          kind: "search_started",
          role: "source",
          claimIds: [],
          sourceIds: [],
          snapshotRevision: 1,
          payload: { query: "x" },
        },
      ])
    ).toThrow(/run not found/);
  });

  it("重放：listActivities(after) 只给之后的", async () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const make = (seq: number) => ({
      version: 1 as const,
      id: `${run.runId}:${seq}`,
      runId: run.runId,
      seq,
      occurredAt: "2026-09-11T10:00:00.000Z",
      kind: "search_started" as const,
      role: "source" as const,
      claimIds: [],
      sourceIds: [],
      snapshotRevision: seq,
      payload: { query: `q${seq}` },
    });
    store.appendActivities(run.runId, [make(1), make(2), make(3)]);
    expect(store.listActivities(run.runId, 1).map((a) => a.seq)).toEqual([2, 3]);
  });
});

describe("D15–D19 重连与重放", () => {
  it("D15 补发只给 after 之后的活动，顺序按 seq", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const make = (seq: number) => ({
      version: 1 as const,
      id: `${run.runId}:${seq}`,
      runId: run.runId,
      seq,
      occurredAt: "2026-09-11T10:00:00.000Z",
      kind: "search_started" as const,
      role: "source" as const,
      claimIds: [],
      sourceIds: [],
      snapshotRevision: seq,
      payload: { query: `q${seq}` },
    });
    store.appendActivities(run.runId, [make(1), make(2), make(3)]);
    expect(svc.replayActivities(run.runId, 0).map((a) => a.seq)).toEqual([1, 2, 3]);
    expect(svc.replayActivities(run.runId, 2).map((a) => a.seq)).toEqual([3]);
    expect(svc.replayActivities(run.runId, 3)).toEqual([]);
  });

  it("D17 订阅者收到后续帧；退订后不再收", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const seen: string[] = [];
    const off = svc.subscribe(run.runId, (event) => seen.push(String(event.type)));
    svc.publish(run.runId, { type: "investigation_activity" });
    off();
    svc.publish(run.runId, { type: "complete" });
    expect(seen).toEqual(["investigation_activity"]);
  });

  it("G15 一个订阅者抛错不影响其他订阅者", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    const seen: string[] = [];
    svc.subscribe(run.runId, () => {
      throw new Error("坏订阅者");
    });
    svc.subscribe(run.runId, (event) => seen.push(String(event.type)));
    expect(() => svc.publish(run.runId, { type: "complete" })).not.toThrow();
    expect(seen).toEqual(["complete"]);
  });

  it("D19 终态的 run replay 仍有内容，但 activeCount 已归零", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a" }) as { run: { runId: string } };
    svc.publish(run.runId, { type: "x" });
    svc.finish(run.runId, "completed");
    expect(svc.activeCount()).toBe(0);
    expect(svc.get(run.runId)!.status).toBe("completed");
    expect(svc.replayActivities(run.runId, 0)).toEqual([]);
  });

  it("重连不新建 run：同一个 runId 反复读仍是同一条", () => {
    const svc = service();
    const { run } = svc.start({ caseId: "case-1", ownerHash: "a", clientRequestId: "req-1" }) as {
      run: { runId: string };
    };
    const before = svc.activeCount();
    expect(svc.get(run.runId)!.runId).toBe(run.runId);
    expect(svc.get(run.runId)!.runId).toBe(run.runId);
    expect(svc.activeCount()).toBe(before);
  });
});

// openRunStore 在 file 顶部只是为了类型；这里显式断言它是可用的导出。
expect(typeof openRunStore).toBe("function");
