/**
 * 当面判断：写在思考折页下面，不进折页，也不替代右侧卷宗。
 */
/**
 * 当面判断：写在思考折页下面，不进折页，也不替代右侧卷宗。
 */
import { humanizeVerdictType } from "../../../../lib/missionShell";
import { hostFromUrl } from "../../../../lib/citationBinding";
import type { ThreadSource } from "../../../../lib/threadSearch";

export type MissionThreadAnswerProps = {
  finalReport: Record<string, unknown> | null;
  sources?: ThreadSource[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verdictTone(verdictType: string): "true" | "false" | "unverified" | "mixed" | "interrupted" {
  const key = verdictType.trim().toLowerCase();
  if (key === "true") return "true";
  if (key === "false" || key === "rumor") return "false";
  if (key === "mixed_misleading" || key === "mixed" || key === "partial") return "mixed";
  return "unverified";
}

export function MissionThreadAnswer({ finalReport, sources = [] }: MissionThreadAnswerProps) {
  if (!finalReport) return null;

  if (finalReport._source === "error-boundary") {
    return (
      <article className="mission-thread-answer" aria-label="判断">
        <p className="mission-final-verdict-word" data-verdict="interrupted">
          这次没查完
        </p>
        <p className="mission-thread-lede">
          {sources.some((s) => s.url)
            ? "结论还没写出来。已经找到的来源可以点开看。"
            : "结论还没写出来。可以再查一次。"}
        </p>
      </article>
    );
  }

  const verdictType = asString(finalReport.verdictType);
  const verdictLabel = humanizeVerdictType(verdictType);
  const lede =
    asString(finalReport.conclusion) || asString(finalReport.summaryForPublic);
  const chips = sources.filter((s) => s.url).slice(0, 3);

  return (
    <article className="mission-thread-answer" aria-label="判断">
      <p className="mission-final-verdict-word" data-verdict={verdictTone(verdictType)}>
        {verdictLabel}
      </p>
      {lede ? <p className="mission-thread-lede">{lede}</p> : null}
      {chips.length > 0 ? (
        <div className="mission-thread-cites">
          {chips.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
              {hostFromUrl(source.url) || source.title}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}
