/**
 * MissionThoughtFold — 核查页主思考折页。
 *
 * 里面只放真实推理句（agent_thought）。判断、来源、检索卡、工具 JSON、
 * 过程时间线都不进这里：判断和来源在右侧卷宗，过程回看也在卷宗里。
 */
import { ThinkingReasoning } from "./ThinkingReasoning";

export type MissionThoughtFoldProps = {
  thinking: boolean;
  elapsedMs?: number;
  sentences?: string[];
};

export function MissionThoughtFold({
  thinking,
  elapsedMs,
  sentences = [],
}: MissionThoughtFoldProps) {
  return (
    <ThinkingReasoning
      layout="thread"
      sentences={sentences}
      thinking={thinking}
      elapsedMs={elapsedMs}
    />
  );
}
