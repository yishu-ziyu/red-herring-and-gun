/**
 * 四个工作职责头像：人物代表分工，不代表专家资质或证据。
 * 素材复用 mvp/public/agents 既有像素头像，不把交接包概念图当已批准品牌。
 */
export type WorkRoleId = "question" | "source" | "context" | "judgment";

export const WORK_ROLES: Array<{
  id: WorkRoleId;
  name: string;
  desc: string;
  doing: string;
  done: string;
  idle: string;
  src: string;
}> = [
  { id: "question", name: "拆问题", desc: "问清具体说法", doing: "拆分问题中", done: "已拆出问题", idle: "尚未开始", src: "/agents/rumor-detector.png" },
  { id: "source", name: "找出处", desc: "追到材料源头", doing: "查找出处中", done: "已带回材料", idle: "尚未开始", src: "/agents/source-validator.png" },
  { id: "context", name: "核语境", desc: "核对时间与范围", doing: "核对范围中", done: "已核对范围", idle: "尚未开始", src: "/agents/fact-checker.png" },
  { id: "judgment", name: "作判断", desc: "给出证据与边界", doing: "形成判断中", done: "已完成判断", idle: "尚未开始", src: "/agents/report-composer.png" },
];

export function roleIndexForPhase(phase: string): number {
  if (phase === "complete") return 4;
  if (phase === "judging") return 2;
  if (phase === "investigating") return 1;
  if (phase === "decomposed") return 1;
  return 0;
}

/** 调查中：拆题完成前只出场拆问题；进入追查后四人才到齐。首页始终四人。 */
export function assembledRoleCount(phase: string, compact: boolean): number {
  if (!compact) return WORK_ROLES.length;
  if (phase === "received" || phase === "decomposed") return 1;
  return WORK_ROLES.length;
}

const ENTER_STAGGER_MS = 160;

type WorkRolesProps = {
  compact?: boolean;
  activeIndex?: number;
  phase?: string;
  /** received 且自证已开始：拆问题还在场，文案改成核对。 */
  preClaimWork?: "splitting" | "checking";
  sourceCount?: number;
};

export function WorkRoles({
  compact = false,
  activeIndex = -1,
  phase,
  preClaimWork,
  sourceCount = 0,
}: WorkRolesProps) {
  const visible = WORK_ROLES.slice(0, assembledRoleCount(phase ?? "", compact));
  const assemble = compact && visible.length > 1;
  return (
    <div className={`gp-roles${compact ? " is-compact" : ""}`} data-gp-roles={compact ? "compact" : "home"}>
      {visible.map((role, index) => {
        const active = compact && index === activeIndex;
        const done = compact && index < activeIndex;
        const checking = compact && active && role.id === "question" && preClaimWork === "checking";
        const caption = compact
          ? done
            ? role.done
            : active
              ? checking
                ? "核对拆出的说法"
                : role.doing
              : ""
          : role.desc;
        const entering = assemble && index > 0;
        return (
          <div
            key={role.id}
            className={`gp-role${active ? " is-active" : ""}${done ? " is-done" : ""}${entering ? " is-enter" : ""}`}
            data-gp-role={role.id}
            data-gp-role-state={compact ? (done ? "done" : active ? "doing" : "idle") : "home"}
            data-gp-role-work={checking ? "checking" : undefined}
            style={entering ? { ["--gp-enter-delay" as string]: `${(index - 1) * ENTER_STAGGER_MS}ms` } : undefined}
          >
            <span className="gp-role-avatar-wrap">
              <img className="gp-role-avatar" src={role.src} alt="" width={74} height={74} />
              {compact && done ? <span className="gp-role-badge-check" aria-hidden="true">✓</span> : null}
              {compact && active && role.id === "source" ? <span className="gp-role-radar-beacon" aria-hidden="true" /> : null}
              {compact && active && role.id === "source" && sourceCount > 0 ? (
                <span className="gp-role-count-badge" aria-label={`已吸收 ${sourceCount} 篇材料`}>+{sourceCount} 篇</span>
              ) : null}
            </span>
            <strong>{role.name}</strong>
            <small className={active ? "gp-role-shimmer" : undefined}>{caption}</small>
          </div>
        );
      })}
    </div>
  );
}
