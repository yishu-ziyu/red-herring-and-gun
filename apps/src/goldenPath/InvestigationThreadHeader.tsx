import type { InvestigationThread } from "../lib/investigationThread";
import { useUiLang } from "../lib/useUiLang";

export function InvestigationThreadHeader({ thread, selectedRoundId, currentQuestion, onSelect }: {
  thread: InvestigationThread;
  selectedRoundId: string | null;
  currentQuestion: string;
  onSelect: (roundId: string | null) => void;
}) {
  const { lang } = useUiLang();
  const en = lang === "en";
  if (!thread.rounds.length) return null;
  return (
    <section className="gp-investigation-thread" data-gp-thread={thread.id} aria-label={en ? "Investigation history" : "同一份调查"}>
      <details className="gp-thread-material"><summary>{en ? "Original material · same investigation" : "原始材料 · 同一份调查"}</summary><p>{thread.originalClaim}</p></details>
      <nav aria-label={en ? "Investigation rounds" : "调查轮次"}>
        {thread.rounds.map((round, index) => <button key={round.id} type="button" aria-pressed={selectedRoundId === round.id} onClick={() => onSelect(round.id)}>
          <span>{index === 0 ? (en ? "Initial check" : "首次核查") : (en ? `Round ${index + 1}` : `第 ${index + 1} 轮`)}</span>
          <small>{round.snapshot.checkedAt ? new Date(round.snapshot.checkedAt).toLocaleString(en ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : (en ? "Date not recorded" : "未记录日期")}</small>
        </button>)}
        <button type="button" aria-pressed={selectedRoundId === null} onClick={() => onSelect(null)}>
          <span>{en ? `Round ${thread.rounds.length + 1} · current` : `第 ${thread.rounds.length + 1} 轮 · 当前`}</span>
          <small>{currentQuestion}</small>
        </button>
      </nav>
      {selectedRoundId ? <p role="status">{en ? "Viewing an earlier record. Its date and judgment are unchanged." : "正在查看之前的记录，原日期与判断未被改写。"} <button type="button" className="gp-link-btn" onClick={() => onSelect(null)}>{en ? "Return to current round" : "返回当前轮次"}</button></p> : null}
    </section>
  );
}
