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
  if (phase === "judging") return 3;
  if (phase === "investigating") return 1;
  if (phase === "decomposed") return 0;
  return 0;
}

type WorkRolesProps = {
  compact?: boolean;
  activeIndex?: number;
};

export function WorkRoles({ compact = false, activeIndex = -1 }: WorkRolesProps) {
  return (
    <div className={`gp-roles${compact ? " is-compact" : ""}`} data-gp-roles={compact ? "compact" : "home"}>
      {WORK_ROLES.map((role, index) => {
        const active = compact && index === activeIndex;
        const done = compact && index < activeIndex;
        const caption = compact ? (done ? role.done : active ? role.doing : role.idle) : role.desc;
        return (
          <div key={role.id} className={`gp-role${active ? " is-active" : ""}`} data-gp-role={role.id}>
            <img className="gp-role-avatar" src={role.src} alt="" width={74} height={74} />
            <strong>{role.name}</strong>
            <small>{caption}</small>
          </div>
        );
      })}
    </div>
  );
}
