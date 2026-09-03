import type { CallJobParams, CallJobResult } from "./callJob.js";

type JobParams = Omit<CallJobParams, "env">;

/** 单次应答：直接给输出对象、按参数算输出、或抛出的错误。 */
export type FakeReply = unknown | ((params: JobParams) => unknown) | Error;

/** 按 job 名配置应答；数组按调用次序消费，用完复用最后一个。 */
export type FakeScript = Record<string, FakeReply | FakeReply[]>;

export interface FakeLlm {
  (params: JobParams): Promise<CallJobResult>;
  calls: JobParams[];
}

export function createFakeLlm(script: FakeScript): FakeLlm {
  const cursors = new Map<string, number>();
  const fake = (async (params: JobParams): Promise<CallJobResult> => {
    fake.calls.push(params);
    const entry = script[params.job];
    if (entry === undefined) throw new Error(`FakeLlm: no script for job "${params.job}"`);
    const replies = Array.isArray(entry) ? entry : [entry];
    const i = cursors.get(params.job) ?? 0;
    cursors.set(params.job, i + 1);
    const reply = replies[Math.min(i, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    const output = typeof reply === "function" ? (reply as (p: JobParams) => unknown)(params) : reply;
    return { output, model: "fake", latencyMs: 0 };
  }) as FakeLlm;
  fake.calls = [];
  return fake;
}
