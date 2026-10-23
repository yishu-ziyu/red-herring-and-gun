import type { InvestigationThread } from "../../shared/investigationThread";
import { useUiLang } from "../lib/useUiLang";

export function InvestigationThreadHeader({ thread, selectedRoundId, onSelect }: {
  thread: InvestigationThread;
  selectedRoundId: string | null;
  onSelect: (roundId: string | null) => void;
}) {
  const { lang } = useUiLang();
  const en = lang === "en";
  if (!thread.rounds.length) return null;
  const roundName = (index: number) => (en ? `Round ${index + 1}` : `第 ${index + 1} 轮`);
  return (
    <section className="gp-investigation-thread gp-column" data-gp-thread={thread.id} aria-label={en ? "Investigation rounds" : "调查轮次"}>
      <details className="gp-thread-material"><summary>{en ? "Original claim" : "最初的说法"}</summary><p>{thread.originalClaim}</p></details>
      <nav aria-label={en ? "Investigation rounds" : "调查轮次"}>
        {thread.rounds.map((round, index) => <button key={round.id} type="button" aria-pressed={selectedRoundId === round.id} onClick={() => onSelect(round.id)}>
          <span>{roundName(index)}</span>
          <small>{round.snapshot.checkedAt ? new Date(round.snapshot.checkedAt).toLocaleString(en ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : (en ? "Date not recorded" : "日期未记录")}</small>
        </button>)}
        <button type="button" aria-pressed={selectedRoundId === null} onClick={() => onSelect(null)}>
          <span>{roundName(thread.rounds.length)}</span>
          <small>{en ? "Current" : "当前"}</small>
        </button>
      </nav>
    </section>
  );
}
