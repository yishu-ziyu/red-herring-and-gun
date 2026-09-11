/**
 * ActivityFeed — 调查中「刚刚做了什么、带回了什么」（IMPLEMENTATION_PLAN §5.1 / §3.2）。
 *
 * 只渲染服务端已校验的活动：模板文案 + payload 白名单。不显示供应商名、工具原文、
 * token 或内部思考。活动层不是第二个真相源：本组件坏了不影响结果页。
 *
 * 新发现不抢滚动：用户上滚看旧项时不上屏，改为「有 N 条新发现」，点了才回到底部。
 */
import { useEffect, useRef, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor, type GpCopy } from "./copy";
import { JUDGMENT_LABEL, domainOf, ROLE_LABEL } from "./snapshotUi";
import type {
  InvestigationEvidenceLink,
  InvestigationSnapshotV1,
  InvestigationSource,
  PublicActivity,
} from "../lib/investigation";

/** 贴着底部（含一点余量）才允许自动跟随。 */
const PIN_THRESHOLD_PX = 24;

export function activityLine(activity: PublicActivity, copy: GpCopy): string {
  const payload = activity.payload;
  switch (activity.kind) {
    case "claim_decomposed":
      return copy.activityClaimDecomposed(payload.claimText ?? "");
    case "search_started":
      return copy.activitySearchStarted(payload.query ?? "");
    case "source_found":
      return copy.activitySourceFound(payload.title ?? "", payload.domain ?? "");
    case "source_checked":
      return copy.activitySourceChecked(
        payload.title ?? "",
        payload.role === "support" || payload.role === "contradict" ? ROLE_LABEL[payload.role] : "",
      );
    case "evidence_assessed":
      return copy.activityEvidenceAssessed(judgmentLabel(payload.judgment));
    case "judgment_revised":
      return copy.activityJudgmentRevised(judgmentLabel(payload.from), judgmentLabel(payload.to));
    case "conflict_detected":
      return copy.activityConflictDetected(payload.summary ?? "");
    case "gap_identified":
      return copy.activityGapIdentified(payload.description ?? "");
    case "run_completed":
      return copy.activityRunCompleted;
  }
}

function judgmentLabel(raw: string | undefined): string {
  if (raw && raw in JUDGMENT_LABEL) return JUDGMENT_LABEL[raw as keyof typeof JUDGMENT_LABEL];
  return "";
}

export function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
}

type ActivityFeedProps = {
  activities: PublicActivity[];
  snapshot: InvestigationSnapshotV1;
  onSelectSource: (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => void;
};

export function ActivityFeed({ activities, snapshot, onSelectSource }: ActivityFeedProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const seenRef = useRef(0);

  useEffect(() => {
    const grew = activities.length - seenRef.current;
    seenRef.current = activities.length;
    if (grew <= 0) return;
    if (!pinned) {
      setUnseen((count) => count + grew);
      return;
    }
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activities.length, pinned]);

  const jumpToLatest = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUnseen(0);
    setPinned(true);
  };

  if (activities.length === 0) return null;

  return (
    <section className="gp-activity" aria-label={copy.activityLabel} data-gp-activity-count={activities.length}>
      <div className="gp-activity-head">
        <span className="gp-activity-label">{copy.activityLabel}</span>
        <span className="gp-activity-count">· {activities.length}</span>
      </div>
      <div
        className="gp-activity-scroller"
        ref={scrollerRef}
        data-gp-activity-pinned={pinned ? "1" : "0"}
        onScroll={(event) => {
          const next = isPinnedToBottom(event.currentTarget);
          setPinned(next);
          if (next) setUnseen(0);
        }}
      >
        <ol className="gp-activity-list">
          {activities.map((activity) => {
            const target = resolveActivitySource(activity, snapshot);
            const line = activityLine(activity, copy);
            return (
              <li key={activity.id} className="gp-activity-item" data-gp-activity-kind={activity.kind}>
                <span className={`gp-activity-role is-${activity.role}`} aria-hidden="true" />
                {target && line ? (
                  <button
                    type="button"
                    className="gp-activity-line is-linked"
                    onClick={(event) =>
                      onSelectSource(target.link, target.source, target.claimId, event.currentTarget)
                    }
                  >
                    {line}
                  </button>
                ) : (
                  <span className="gp-activity-line">{line}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {unseen > 0 ? (
        <button type="button" className="gp-activity-new" onClick={jumpToLatest} data-gp-activity-unseen={unseen}>
          {copy.activityUnseen(unseen)}
        </button>
      ) : null}
    </section>
  );
}

/** 活动的引用对象必须在当前快照里找得到；找不到就不渲染成可点行。 */
function resolveActivitySource(
  activity: PublicActivity,
  snapshot: InvestigationSnapshotV1,
): { link: InvestigationEvidenceLink; source: InvestigationSource; claimId: string } | null {
  if (activity.claimIds.length === 0 || activity.sourceIds.length === 0) return null;
  const claim = snapshot.claims.find((item) => item.id === activity.claimIds[0]);
  if (!claim) return null;
  for (const sourceId of activity.sourceIds) {
    const link = claim.evidence.find((item) => item.sourceId === sourceId);
    const source = snapshot.sources.find((item) => item.id === sourceId);
    if (link && source) return { link, source, claimId: claim.id };
  }
  return null;
}
