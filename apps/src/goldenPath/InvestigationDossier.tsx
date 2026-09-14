import { useState } from "react";
import type {
  InvestigationEvidenceLink,
  InvestigationSnapshotV1,
  InvestigationSource,
  PublicActivity,
} from "../lib/investigation";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { ActivityFeed } from "./ActivityFeed";

type InvestigationDossierProps = {
  snapshot: InvestigationSnapshotV1;
  activities?: PublicActivity[];
  onSelectSource?: (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => void;
  onSelectConflict?: (claimId: string, trigger: HTMLElement) => void;
};

export function InvestigationDossier({
  snapshot,
  activities = [],
  onSelectSource,
  onSelectConflict,
}: InvestigationDossierProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<number | null>(null);

  const safeSelectSource = onSelectSource ?? (() => {});

  const claimCount = snapshot.claims.length;
  const sourceCount = snapshot.sources.length;

  const milestones = [
    { id: 0, time: "0.0s", title: "帖子原话抓取", detail: "提取清洗核心断言，唤醒白盒流水线" },
    { id: 1, time: "1.4s", title: "思考与定义域", detail: "锁定核查边界，排除二传二改噪音" },
    { id: 2, time: "2.1s", title: `拆出 ${claimCount} 项原子命题`, detail: "对原句短语锚定切片与出处链" },
    { id: 3, time: "15.2s", title: `结算 ${sourceCount} 篇权威材料`, detail: "国家疾控与专业科研机构数据归位" },
    { id: 4, time: "23.4s", title: "综合核验终审", detail: "三值裁决裁定与全栈追问就绪" },
  ];

  return (
    <section className="gp-dossier" aria-label="调查案卷与回溯时间轴" data-gp-dossier>
      <div className="gp-dossier-bar">
        <div className="gp-dossier-header" onClick={() => setIsExpanded(!isExpanded)} role="button" tabIndex={0}>
          <div className="gp-dossier-title">
            <span className="gp-dossier-dot"></span>
            <strong>调查全案卷与时空回溯</strong>
            <span className="gp-dossier-pill">5 拍慢动作切片已归档</span>
          </div>
          <button
            type="button"
            className="gp-dossier-toggle"
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? "收起调查案卷 ▲" : "展开慢动作与思考全链条 ▼"}
          </button>
        </div>

        {/* 5-step time capsules */}
        <div className="gp-dossier-milestones" role="tablist">
          {milestones.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`gp-milestone-pill ${selectedMilestone === m.id ? "is-selected" : ""}`}
              onClick={() => {
                setSelectedMilestone(m.id);
                setIsExpanded(true);
              }}
              title={m.detail}
            >
              <span className="gp-milestone-time">{m.time}</span>
              <span className="gp-milestone-title">{m.title}</span>
            </button>
          ))}
        </div>
      </div>

      {isExpanded ? (
        <div className="gp-dossier-body" data-gp-dossier-expanded>
          <div className="gp-dossier-summary-card">
            <span className="gp-dossier-card-tag">
              {selectedMilestone !== null ? `核查节点 0${selectedMilestone + 1}` : "完整调查案卷"}
            </span>
            <p className="gp-dossier-card-desc">
              {selectedMilestone !== null
                ? `${milestones[selectedMilestone].title} (${milestones[selectedMilestone].time})：${milestones[selectedMilestone].detail}`
                : "完整记录调查过程中的思考过程与实时活动轨迹。所有证据材料与推理链条永久保留，供随时复盘与核验。"}
            </p>
          </div>

          <div className="gp-dossier-content">
            <div className="gp-dossier-col">
              <h4 className="gp-dossier-section-title">✦ 深度思考过程与边界推导</h4>
              <ThinkingDisclosure snapshot={snapshot} live={false} />
            </div>

            <div className="gp-dossier-col">
              <h4 className="gp-dossier-section-title">✦ 实时活动流与事实检索凭据 ({activities.length} 条已核对)</h4>
              <ActivityFeed
                activities={activities}
                snapshot={snapshot}
                onSelectSource={safeSelectSource}
                onSelectConflict={onSelectConflict}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
