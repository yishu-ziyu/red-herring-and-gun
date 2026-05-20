import type { EvidenceRoute, Subclaim } from "../lib/schemas";

const pathCopy: Record<string, { title: string; risk: string; why: string }> = {
  C2: {
    title: "岗位真的减少了吗？",
    risk: "数据口径风险",
    why: "如果岗位没有同口径下降，后面的因果判断就站不住。",
  },
  C3: {
    title: "AI 能替代哪些任务？",
    risk: "任务-岗位混淆",
    why: "AI 能做某些任务，不等于整个岗位消失。",
  },
  C4: {
    title: "是不是 AI 导致的？",
    risk: "最高风险",
    why: "“导致”需要时间顺序、机制和替代解释，不能靠同期变化。",
  },
  C5: {
    title: "有没有反向证据？",
    risk: "单边证据风险",
    why: "只找支持材料会让结论越来越偏。",
  },
};

interface InvestigationPathsProps {
  subclaims: Subclaim[];
  routes: EvidenceRoute[];
  selectedSubclaimId: string;
  onSelect: (id: string) => void;
}

export function InvestigationPaths({ subclaims, routes, selectedSubclaimId, onSelect }: InvestigationPathsProps) {
  const visibleSubclaims = subclaims.filter((subclaim) => ["C2", "C3", "C4", "C5"].includes(subclaim.id));
  const selectedRoute = routes.find((route) => route.subclaimId === selectedSubclaimId);
  const selectedCopy = pathCopy[selectedSubclaimId];

  return (
    <section className="product-card">
      <div className="card-label">第二步：选择你想先查的风险</div>
      <h2>你想先查哪一条？</h2>
      <div className="path-layout">
        <div className="path-list">
          {visibleSubclaims.map((subclaim) => {
            const copy = pathCopy[subclaim.id];
            const route = routes.find((item) => item.subclaimId === subclaim.id);
            return (
              <button
                type="button"
                className={subclaim.id === selectedSubclaimId ? "path-card selected" : "path-card"}
                onClick={() => onSelect(subclaim.id)}
                key={subclaim.id}
              >
                <span>{copy.risk}</span>
                <strong>{copy.title}</strong>
                <small>{copy.why}</small>
                <em>{route?.neededEvidence.length ?? 0} 类证据</em>
              </button>
            );
          })}
        </div>
        {selectedRoute ? (
          <div className="path-detail">
            <p className="selected-risk">当前路径：{selectedCopy.title}</p>
            <div className="detail-grid">
              <div>
                <h3>要判断这条，需要</h3>
                <ul>
                  {selectedRoute.neededEvidence.map((need) => (
                    <li key={need}>{need}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>这些不能直接用</h3>
                <ul>
                  {selectedRoute.notAcceptable.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="minimum-rule">最低规则：{selectedRoute.minimumOutputRule}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
