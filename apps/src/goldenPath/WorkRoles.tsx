/**
 * 首页的四个工作职责头像：人物代表分工，不代表专家资质或证据。
 * 素材复用 apps/public/agents 既有像素头像，不把交接包概念图当已批准品牌。
 */
const WORK_ROLES: Array<{ id: string; name: string; desc: string; src: string }> = [
  { id: "question", name: "拆问题", desc: "问清具体说法", src: "/agents/rumor-detector.png" },
  { id: "source", name: "找出处", desc: "追到材料源头", src: "/agents/source-validator.png" },
  { id: "context", name: "核语境", desc: "核对时间与范围", src: "/agents/fact-checker.png" },
  { id: "judgment", name: "作判断", desc: "给出证据与边界", src: "/agents/report-composer.png" },
];

export function WorkRoles() {
  return (
    <div className="gp-roles" data-gp-roles="home">
      {WORK_ROLES.map((role) => (
        <div key={role.id} className="gp-role" data-gp-role={role.id} data-gp-role-state="home">
          <span className="gp-role-avatar-wrap">
            <img className="gp-role-avatar" src={role.src} alt="" width={64} height={64} />
          </span>
          <strong>{role.name}</strong>
          <small>{role.desc}</small>
        </div>
      ))}
    </div>
  );
}
