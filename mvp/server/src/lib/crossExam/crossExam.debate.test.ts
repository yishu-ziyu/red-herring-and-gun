import { expect, it, vi } from "vitest";
import { buildAtomSearchBundle } from "../atomSearch";
import { findCrossExamTargets, makeSecondOpinionCall, runCrossExam } from "./crossExam";

it("只将实际引用绑定到所属证据，未知 URL 不构成冲突，明确缺口可触发", () => {
  const a = { url: "https://a.test/1", title: "A", snippet: "原始证据" };
  const b = { url: "https://b.test/1", title: "B", snippet: "相反证据" };
  const bundle = buildAtomSearchBundle([{ atom: "命题", result: { sources: [a, b] } }], s => s);
  const select = (v: object) => findCrossExamTargets({ verdicts: [{ claimAtom: "命题", ...v }], bundle, claimAtomKeyFn: s => s });
  expect(select({ supportingSources: [{ url: b.url }], contradictingSources: [{ url: a.url }] })[0]).toMatchObject({ supporting: [b], contradicting: [a] });
  expect(select({ supportingSources: [{ url: a.url }], contradictingSources: [{ url: "https://unknown.test/" }] })).toEqual([]);
  expect(select({ evidenceGaps: ["缺少研究样本规模"] })).toHaveLength(1);
});

it("取消或预算用尽后不再补查或回应，至多处理两个命题", async () => {
  const controller = new AbortController();
  const target = { atom: "命题", atomKey: "命题", primaryVerdict: "true", supporting: [], contradicting: [] };
  const search = vi.fn(async () => []);
  const respond = vi.fn(async () => ({ response: "回应" }));
  const second = vi.fn(async () => { controller.abort(); return { model: "m", verdict: "unverified" as const, reason: "缺口", boundary: "", challenge: "谁是原作者？", query: "原作者" }; });
  const result = await runCrossExam({ claim: "命题", targets: [target, target, target], callSecondOpinion: second, search, respond, signal: controller.signal });
  expect(second).toHaveBeenCalledTimes(1);
  expect(search).not.toHaveBeenCalled();
  expect(respond).not.toHaveBeenCalled();
  expect(result.atoms).toHaveLength(2);
  expect(result.atoms.every(a => a.status === "unresolved")).toBe(true);
  second.mockClear();
  await runCrossExam({ claim: "命题", targets: [target], callSecondOpinion: second, deadline: Date.now() - 1 });
  expect(second).not.toHaveBeenCalled();
});

it("无疑问不强行回应；有疑问但无补查问题可依据已有证据回应", async () => {
  const target = { atom: "命题", atomKey: "命题", primaryVerdict: "true", supporting: [], contradicting: [] };
  const search = vi.fn(async () => []);
  const respond = vi.fn(async () => ({ response: "", finalVerdict: "true" }));
  const second = makeSecondOpinionCall(async () => ({ model: "m", output: { reason: "未发现矛盾", verdict: "true" } }));
  await runCrossExam({ claim: "命题", targets: [target], callSecondOpinion: second, search, respond });
  expect(search).not.toHaveBeenCalled();
  expect(respond).not.toHaveBeenCalled();
  const result = await runCrossExam({ claim: "命题", targets: [target], callSecondOpinion: makeSecondOpinionCall(async () => ({ model: "m", output: { challenge: "绝对化措辞有据吗？" } })), search, respond });
  expect(respond).toHaveBeenCalledOnce();
  expect(search).not.toHaveBeenCalled();
  expect(result.atoms[0]).toMatchObject({ status: "unresolved", searchStatus: "not_run", response: "" });
});

it("实际质询触发一次补查和回应，失败不泄露 provider 信息或继续调用", async () => {
  const source = { url: "https://a.test/1", title: "A", snippet: "证据" };
  const target = { atom: "命题", atomKey: "命题", primaryVerdict: "true", supporting: [source], contradicting: [] };
  const respond = vi.fn(async () => ({ response: "样本仅覆盖成人，保留限定后的结论", finalVerdict: "partial" }));
  const search = vi.fn(async () => [source]);
  const result = await runCrossExam({ claim: "命题", targets: [target], callSecondOpinion: makeSecondOpinionCall(async () => ({ model: "second", output: { verdict: "unverified", reason: "样本范围不明", challenge: "是否适用于儿童？", boundary: "仅成人", query: "研究 样本 儿童", sources: [source.url, "javascript:alert(1)"] } })), search, respond });
  expect(search).toHaveBeenCalledTimes(1);
  expect(respond).toHaveBeenCalledTimes(1);
  expect(result.atoms[0]).toMatchObject({ challenge: "是否适用于儿童？", response: "样本仅覆盖成人，保留限定后的结论", status: "answered", finalVerdict: "partial", sources: [source] });
  expect(result.confidenceAdjustment).toBe(0);
  search.mockRejectedValueOnce(new Error("secret-provider-key"));
  respond.mockClear();
  const failed = await runCrossExam({ claim: "命题", targets: [target, target], callSecondOpinion: makeSecondOpinionCall(async () => ({ model: "m", output: { challenge: "缺哪一段？", query: "原文", reason: "缺口" } })), search, respond });
  expect(respond).not.toHaveBeenCalled();
  expect(JSON.stringify(failed)).not.toContain("secret-provider-key");
  expect(failed.atoms[0].status).toBe("unresolved");
});
