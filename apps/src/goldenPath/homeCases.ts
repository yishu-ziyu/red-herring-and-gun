/**
 * 首页已完成调查案例：生产 fixture，脱敏、人工检查过。
 * 查看走同一套结果组件，不发起调查、不扣额、不假装实时过程。
 */
import type { InvestigationSnapshotV1 } from "../lib/investigation";
import { conflictKnownReason, mixedComplete, unresolvedComplete } from "./fixtures";

export type HomeCaseId = "mixed" | "context" | "unresolved";

export type HomeCaseCard = {
  id: HomeCaseId;
  mark: string;
  claim: string;
  finding: string;
  investigatedAt: number;
  dateLabel: string;
  checkedAtIso: string;
};

const MIXED_AT = "2026-09-06T08:00:00.000Z";
const CONTEXT_AT = "2026-09-07T08:00:00.000Z";
const UNRESOLVED_AT = "2026-09-08T08:00:00.000Z";

const CATALOG: Array<HomeCaseCard & { build: () => InvestigationSnapshotV1 }> = [
  {
    id: "mixed",
    mark: "生产 fixture · 混合说法",
    claim: "维生素C能治感冒，而且每次感冒都应当输液。",
    finding: "只有前半截有依据且被夸大；后半截站不住。",
    checkedAtIso: MIXED_AT,
    investigatedAt: Date.parse(MIXED_AT),
    dateLabel: "2026/9/6",
    build: mixedComplete,
  },
  {
    id: "context",
    mark: "生产 fixture · 语境错位",
    claim: "新规要求 2026 年起电动车必须装识别芯片。",
    finding: "该说法把地方试点说成了全国新规。",
    checkedAtIso: CONTEXT_AT,
    investigatedAt: Date.parse(CONTEXT_AT),
    dateLabel: "2026/9/7",
    build: conflictKnownReason,
  },
  {
    id: "unresolved",
    mark: "生产 fixture · 证据不足",
    claim: "某小区本月的自来水异味来自新增消毒工艺。",
    finding: "公开材料还撑不住这条说法，异味来源仍未查清。",
    checkedAtIso: UNRESOLVED_AT,
    investigatedAt: Date.parse(UNRESOLVED_AT),
    dateLabel: "2026/9/8",
    build: unresolvedComplete,
  },
];

export function homeCaseCards(): HomeCaseCard[] {
  return CATALOG.map(({ build: _build, ...card }) => card);
}

export function homeCaseSnapshot(id: HomeCaseId): {
  snapshot: InvestigationSnapshotV1;
  investigatedAt: number;
  claim: string;
} | null {
  const item = CATALOG.find((entry) => entry.id === id);
  if (!item) return null;
  const base = item.build();
  return {
    snapshot: { ...base, checkedAt: base.checkedAt ?? item.checkedAtIso },
    investigatedAt: item.investigatedAt,
    claim: item.claim,
  };
}
