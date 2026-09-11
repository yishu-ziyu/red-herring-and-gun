/**
 * piTools.ts — pi-agent 业务工具扩展（P0a 试点）。
 *
 * 内联扩展工厂：把核查域能力注册成 pi 工具。P0 先上 2 个最小工具——
 * web_search（现网检索矩阵）+ todo_write（证据追索/任务板占位）。
 * 判决工具（judge_atom / submit_verdict）留待 P1，由 finalizeLoopReport 兜底。
 */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callParallelSearchProviders } from "../searchProviders.js";

export interface PiToolDeps {
  env: Record<string, string>;
  onTodo?: (item: string) => void;
  /** web_search 执行后透出命中的可点开 URL（供 finalizeLoopReport 的 URL 闸收集）。 */
  onSearchResult?: (urls: string[]) => void;
  /** submit_verdict 被模型调用时透出草稿（判决不在这里做，只转交收束闸）。 */
  onSubmit?: (args: Record<string, unknown>) => void;
}

/** 扩展工厂：注册核查域业务工具。 */
export function toolExtension(deps: PiToolDeps): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "web_search",
      label: "Web Search",
      description:
        "对一句待核查断言做并行公开检索（360/AnySearch/Metaso/Tavily/Exa）。返回可点开的来源列表与各源摘要。用于溯源。",
      parameters: Type.Object({
        query: Type.String({ description: "检索查询，建议含原始断言关键词与 辟谣/官方 等方向词" }),
      }),
      execute: async (_toolCallId, params: { query: string }) => {
        const result = await callParallelSearchProviders({ env: deps.env, query: params.query });
        const sources = Array.isArray(result.sources)
          ? result.sources
              .slice(0, 8)
              .map(
                (s: { title?: string; url?: string; snippet?: string }, i: number) =>
                  `${i + 1}. ${s.title || "未命名来源"} ${s.url || ""}\n   ${(s.snippet || "").slice(0, 200)}`
              )
              .join("\n")
          : "（无来源返回）";
        const urls = Array.isArray(result.sources)
          ? result.sources
              .map((s: { url?: string }) => (typeof s?.url === "string" ? s.url : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [];
        deps.onSearchResult?.(urls);
        return {
          content: [{ type: "text" as const, text: `检索「${params.query}」返回来源：\n${sources.slice(0, 4000)}` }],
          details: {
            tool: "web_search",
            query: params.query,
            sourceCount: urls.length,
            sourceIds: urls,
          },
        };
      },
    });

    pi.registerTool({
      name: "todo_write",
      label: "Task Board",
      description: "把待办的证据追索目标写进任务板（如「找原始出处」「找反证」）。只记录计划，不做检索。",
      parameters: Type.Object({
        item: Type.String({ description: "一条待办/证据缺口" }),
      }),
      execute: async (_toolCallId, params: { item: string }) => {
        deps.onTodo?.(params.item);
        return {
          content: [{ type: "text" as const, text: `任务板已记录：${params.item}` }],
          details: { tool: "todo_write", item: params.item },
        };
      },
    });

    pi.registerTool({
      name: "submit_verdict",
      label: "Submit Verdict",
      description:
        "收束判断。填写你从公开来源得到的逐条判定草稿：claimAtoms（拆出的断言）、claimAtomTypes（逐条类型 true/false 或 stance）、subclaimVerdicts（逐条判定 + 证据 + 来源 URL）、verdictType、conclusion、recommendation。系统会再过自证与 URL 闸后产出最终报告。",
      parameters: Type.Object({
        verdictType: Type.String({
          description: "整句判定：true / false / mixed_misleading / unverified",
        }),
        conclusion: Type.String({ description: "直接回答原句的中文结论（第一句不写 能信/不能信）" }),
        recommendation: Type.Optional(Type.String({ description: "只重复答案，不写行动建议" })),
        claimAtoms: Type.Optional(Type.Array(Type.String({ description: "拆出可核查断言" }))),
        claimAtomTypes: Type.Optional(
          Type.Array(
            Type.Object({
              text: Type.String(),
              type: Type.String({ description: "fact / stance / value / prediction / causal" }),
              verifiable: Type.Optional(Type.Boolean()),
            })
          )
        ),
        subclaimVerdicts: Type.Optional(
          Type.Array(
            Type.Object({
              claimAtom: Type.String(),
              verdict: Type.String({ description: "true / false / partial / unverified" }),
              evidence: Type.String(),
              sources: Type.Optional(Type.Array(Type.String({ description: "来源 URL" }))),
            })
          )
        ),
      }),
      execute: async (_toolCallId, params: Record<string, unknown>) => {
        deps.onSubmit?.(params);
        return {
          content: [
            { type: "text" as const, text: "已收束。判定草稿将进入自证与 URL 闸，产出最终报告。" },
          ],
          details: { tool: "submit_verdict" },
        };
      },
    });
  };
}