/**
 * claimDecomposer.ts — Claim 拆解器
 *
 * MVP Demo 阶段：提供模拟拆解逻辑
 * 后续迭代：接入真实 LLM 进行智能 claim 分解
 */

import type { ClaimDecompositionResult, AtomicProposition } from "./schemas";

/**
 * 模拟拆解 claim 为原子命题
 * 当前为 MVP Demo 实现，返回预定义结果
 */
export async function decomposeClaim(
  claim: string
): Promise<ClaimDecompositionResult> {
  // TODO: 接入真实 LLM 进行智能分解
  // 当前返回模拟数据以支撑 MVP Demo

  const atomicPropositions: AtomicProposition[] = [
    {
      id: "prop-a",
      text: `"${claim}" 的核心事实是否可被直接验证`,
      type: "事实陈述",
      verifiability: "可直接验证",
    },
    {
      id: "prop-b",
      text: `该 claim 中的关键归因或技术描述是否准确`,
      type: "归因断言",
      verifiability: "可直接验证",
    },
    {
      id: "prop-c",
      text: `该 claim 中的数值或效果数据是否有权威来源支撑`,
      type: "数值断言",
      verifiability: "需间接推断",
    },
  ];

  return {
    originalClaim: claim,
    atomicPropositions,
    decompositionReasoning:
      "将复杂 claim 拆分为三个可独立验证的维度：事实存在性、技术属性准确性、效果数据可信度。",
  };
}

/**
 * 快速检查 claim 是否适合进行交叉验证
 */
export function isClaimVerifiable(claim: string): {
  verifiable: boolean;
  reason: string;
} {
  if (!claim || claim.trim().length < 10) {
    return { verifiable: false, reason: "Claim 过短，无法提取有效断言" };
  }

  // 检查是否包含可验证的事实性内容
  const hasFactualContent = /[0-9%年月日]|是|有|推出|发布|实施/.test(claim);
  if (!hasFactualContent) {
    return {
      verifiable: false,
      reason: "未检测到可验证的事实性内容（如时间、数字、具体行为）",
    };
  }

  return { verifiable: true, reason: "包含可验证的事实性断言" };
}
