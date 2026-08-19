/**
 * memoryCandidateHandlers + JsonlMemoryCandidateStore unit tests
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMemoryCandidateStore,
  listMemoryCandidatesHandler,
  setMemoryCandidateStoreForTests,
  updateMemoryCandidateHandler,
} from "./memoryCandidateHandlers";
import { JsonlMemoryCandidateStore } from "./memoryCandidateStore";
import type { MemoryCandidate } from "./memoryCandidateTypes";

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "mc-1",
    kind: "search_strategy",
    status: "proposed",
    title: "隔夜菜致癌检索策略",
    summary: "有效查询含官方回应与毒理学综述",
    confidence: 0.8,
    tags: ["健康", "隔夜菜"],
    proposedByAgent: "rumor_detector",
    provenance: {
      runId: "run-1",
      claim: "隔夜菜会致癌吗",
      normalizedClaim: "隔夜菜会致癌吗",
      createdAt: 1_700_000_000_000,
      sourceUrls: [],
      unresolvedQuestions: [],
    },
    payload: { effectiveQueries: ["隔夜菜 致癌 官方"] },
    ...overrides,
  };
}

function mockReq(body: unknown = null): any {
  return { body };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("JsonlMemoryCandidateStore", () => {
  let dir: string;
  let store: JsonlMemoryCandidateStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mc-store-"));
    store = new JsonlMemoryCandidateStore(join(dir, "candidates.jsonl"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("propose + list 返回候选", async () => {
    await store.propose([makeCandidate(), makeCandidate({ id: "mc-2", title: "另一条" })]);
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id).sort()).toEqual(["mc-1", "mc-2"]);
  });

  it("setStatus accepted 后 searchAccepted 可命中", async () => {
    await store.propose([makeCandidate()]);
    const updated = await store.setStatus("mc-1", "accepted", "用户确认");
    expect(updated?.status).toBe("accepted");
    expect(updated?.statusReason).toBe("用户确认");

    const hits = await store.searchAccepted("隔夜菜致癌");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].candidate.id).toBe("mc-1");
    expect(hits[0].candidate.status).toBe("accepted");
  });

  it("G2 语义召回：同义改写零词面交集仍可召回（电瓶车→电动车）", async () => {
    await store.propose([
      makeCandidate({
        id: "mc-ev",
        title: "电动车失窃核查",
        summary: "电动车被盗相关核查经验",
        tags: ["社会", "盗窃"],
        provenance: {
          runId: "run-ev",
          claim: "电动车失窃后被送往国外销毁",
          normalizedClaim: "电动车失窃后被送往国外销毁",
          createdAt: 1_700_000_001_000,
          sourceUrls: [],
          unresolvedQuestions: [],
        },
      }),
    ]);
    await store.setStatus("mc-ev", "accepted");

    // 查询用同义说法：电瓶车/被偷 ↔ 电动车/失窃
    const hits = await store.searchAccepted("我说我的电瓶车叫谁偷走了，原来送到非洲去了");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].candidate.id).toBe("mc-ev");
  });

  it("proposed 不进入 searchAccepted", async () => {
    await store.propose([makeCandidate({ status: "proposed" })]);
    const hits = await store.searchAccepted("隔夜菜致癌");
    expect(hits).toHaveLength(0);
  });

  it("setStatus 未知 id → null", async () => {
    const result = await store.setStatus("missing", "accepted");
    expect(result).toBeNull();
  });
});

describe("memoryCandidateHandlers", () => {
  let dir: string;
  let store: JsonlMemoryCandidateStore;
  let previous: ReturnType<typeof getMemoryCandidateStore>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mc-handler-"));
    store = new JsonlMemoryCandidateStore(join(dir, "candidates.jsonl"));
    previous = getMemoryCandidateStore();
    setMemoryCandidateStoreForTests(store);
    await store.propose([makeCandidate()]);
  });

  afterEach(async () => {
    setMemoryCandidateStoreForTests(previous);
    await rm(dir, { recursive: true, force: true });
  });

  it("GET list → 200 + candidates", async () => {
    const res = mockRes();
    await listMemoryCandidatesHandler(mockReq() as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe("mc-1");
  });

  it("POST setStatus accepted → 200 + candidate", async () => {
    const res = mockRes();
    await updateMemoryCandidateHandler(
      mockReq({ action: "setStatus", id: "mc-1", status: "accepted", reason: "写入知识库" }) as never,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.candidate.status).toBe("accepted");
    expect(res.body.candidate.statusReason).toBe("写入知识库");
  });

  it("POST 未知 action → 400", async () => {
    const res = mockRes();
    await updateMemoryCandidateHandler(mockReq({ action: "delete", id: "mc-1" }) as never, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("未知");
  });

  it("POST 非法 status → 400", async () => {
    const res = mockRes();
    await updateMemoryCandidateHandler(
      mockReq({ action: "setStatus", id: "mc-1", status: "maybe" }) as never,
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("POST 未知 id → 404", async () => {
    const res = mockRes();
    await updateMemoryCandidateHandler(
      mockReq({ action: "setStatus", id: "nope", status: "accepted" }) as never,
      res,
    );
    expect(res.statusCode).toBe(404);
  });
});
