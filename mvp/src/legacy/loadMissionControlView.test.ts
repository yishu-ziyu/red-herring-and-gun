/**
 * 生产 loader 的失败/预取语义。不用复制函数，不预先 import 工作台模块。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  loadMissionControlView,
  prefetchMissionControlView,
  resetMissionControlViewLoaderForTests,
  type MissionControlModule,
} from "./loadMissionControlView";

function fakeModule(): MissionControlModule {
  return { MissionControlView: () => null } as unknown as MissionControlModule;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function withCapturedUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const listener = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", listener);
  return run()
    .then(async () => {
      await flushMicrotasks();
      return reasons;
    })
    .finally(() => {
      process.removeAllListeners("unhandledRejection");
      for (const entry of previous) {
        process.on("unhandledRejection", entry as NodeJS.UnhandledRejectionListener);
      }
    });
}

afterEach(() => {
  resetMissionControlViewLoaderForTests();
});

describe("loadMissionControlView / prefetchMissionControlView", () => {
  it("prefetch consumes rejection and resets cache so the next load can succeed", async () => {
    const boom = new Error("chunk-load-failed");
    let attempts = 0;
    resetMissionControlViewLoaderForTests(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(boom);
      return Promise.resolve(fakeModule());
    });

    const unhandled = await withCapturedUnhandled(async () => {
      await prefetchMissionControlView();
    });
    expect(unhandled).toEqual([]);
    expect(attempts).toBe(1);

    const firstLoad = loadMissionControlView();
    await expect(firstLoad).resolves.toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("does not turn loader failure into a successful module", async () => {
    resetMissionControlViewLoaderForTests(() => Promise.reject(new Error("chunk-load-failed")));
    await expect(loadMissionControlView()).rejects.toThrow("chunk-load-failed");
    await expect(loadMissionControlView()).rejects.toThrow("chunk-load-failed");
  });
});
