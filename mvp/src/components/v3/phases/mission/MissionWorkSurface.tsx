/**
 * MissionWorkSurface — right-hand desk. The thing being made.
 *
 * Left column talks. This column shows split claims, sources, and the
 * forming 能信 / 不能信. Never invents atoms or URLs.
 */
import {
  deskPaneForProcessTitle,
  humanizeClaimType,
  humanizeVerdictType,
  type DeskPane,
} from "../../../../lib/missionShell";
import type { MissionShellModel, ShellToolItem } from "../../../../lib/missionShell";
import { isSearchShellTool, sitesFromSearchResult } from "./WebSearch";
import styles from "./MissionWorkSurface.module.css";

export interface MissionWorkSurfaceProps {
  model: MissionShellModel;
  /** Left-column step title. When set, the desk shows that step's deliverable. */
  selectedTitle?: string | null;
  className?: string;
}

function snippetFromSource(
  result: Record<string, unknown> | undefined,
  href?: string,
  title?: string
): string | undefined {
  if (!result) return undefined;
  const bags: unknown[] = [];
  if (Array.isArray(result.sources)) bags.push(...result.sources);
  if (Array.isArray(result.supportingEvidence)) bags.push(...result.supportingEvidence);
  if (Array.isArray(result.contradictingEvidence)) bags.push(...result.contradictingEvidence);
  for (const raw of bags) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as { url?: string; href?: string; title?: string; snippet?: string };
    const matchHref = (o.url || o.href || "").trim();
    const matchTitle = (o.title || "").trim();
    if ((href && matchHref === href) || (title && matchTitle === title)) {
      return typeof o.snippet === "string" && o.snippet.trim() ? o.snippet.trim() : undefined;
    }
  }
  return undefined;
}

function searchTools(model: MissionShellModel): ShellToolItem[] {
  return model.tools.filter((t) => isSearchShellTool(t));
}

function resolvePane(model: MissionShellModel, selectedTitle?: string | null): DeskPane {
  if (selectedTitle) return deskPaneForProcessTitle(selectedTitle);
  if (model.verdict.present && !model.live) return "verdict";
  if (searchTools(model).some((t) => t.status === "success" || t.status === "loading")) {
    return "sources";
  }
  return "atoms";
}

function deskStatus(model: MissionShellModel, pane: DeskPane): string {
  if (model.errorMessage) return "中断";
  if (pane === "verdict") return model.verdict.present ? "已有判断" : model.live ? "正在写判断" : "还没有判断";
  if (pane === "sources") {
    if (searchTools(model).some((t) => t.status === "loading")) return "正在对照材料";
    if (searchTools(model).some((t) => t.status === "success")) return "材料已回来";
    return "还没有来源";
  }
  if (model.understanding?.atoms.length) return "已拆开";
  if (model.live) return "正在拆开";
  return "等待";
}

export function MissionWorkSurface({ model, selectedTitle, className }: MissionWorkSurfaceProps) {
  const atoms = model.understanding?.atoms ?? [];
  const searches = searchTools(model);
  const sources = searches.flatMap((tool) =>
    sitesFromSearchResult(tool.result).map((site) => ({
      ...site,
      snippet: snippetFromSource(tool.result, site.href, site.title),
      query: tool.query,
    }))
  );
  const searching = searches.some((t) => t.status === "loading");
  const verdict = model.verdict;
  const typeZh = humanizeClaimType(model.claimType);
  const pane = resolvePane(model, selectedTitle);
  const title =
    pane === "verdict"
      ? "能不能信"
      : pane === "sources"
        ? "对照到的材料"
        : typeZh
          ? `这是${typeZh}`
          : "正在看这句话";

  return (
    <section
      className={[styles.desk, className].filter(Boolean).join(" ")}
      aria-label="核对台"
      data-live={model.live ? "1" : "0"}
      data-pane={pane}
    >
      <header className={styles.head}>
        <div>
          <strong className={styles.title}>{title}</strong>
        </div>
        <em className={styles.status} data-live={model.live ? "1" : "0"}>
          {deskStatus(model, pane)}
        </em>
      </header>

      {pane === "verdict" ? (
        verdict.present ? (
          <div className={styles.verdict} role="region" aria-label="能不能信">
            <span className={styles.verdictType}>{humanizeVerdictType(verdict.verdictType)}</span>
            {verdict.conclusion ? <p className={styles.verdictText}>{verdict.conclusion}</p> : null}
            {verdict.shareAdvice ? <p className={styles.advice}>{verdict.shareAdvice}</p> : null}
          </div>
        ) : (
          <p className={styles.wait}>{model.live ? "判断还没写完。" : "这次还没有判断。"}</p>
        )
      ) : null}

      {pane === "atoms" ? (
        <div className={styles.block}>
          <h2 className={styles.blockTitle}>要核对的判断</h2>
          {atoms.length === 0 ? (
            <p className={styles.wait}>
              {model.live ? "拆完会出现条目。" : "这次还没有拆出判断。"}
            </p>
          ) : (
            <ol className={styles.atoms}>
              {atoms.map((atom, index) => {
                const atomType = humanizeClaimType(atom.type);
                return (
                  <li key={`${index}-${atom.text.slice(0, 16)}`} className={styles.atom}>
                    <span className={styles.num}>{index + 1}</span>
                    <span className={styles.atomText}>{atom.text}</span>
                    <span className={styles.atomMeta}>
                      {atom.verifiable ? (
                        <span className={styles.tagOk}>可核对</span>
                      ) : (
                        <span className={styles.tagStance}>立场</span>
                      )}
                      {atomType ? <span className={styles.atomType}>{atomType}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}

      {pane === "sources" ? (
        <div className={styles.block}>
          {sources.length === 0 ? (
            <p className={styles.wait}>
              {searching ? "正在对照公开材料。" : "来源会写在这里。"}
            </p>
          ) : (
            <ul className={styles.sources}>
              {sources.map((site) => (
                <li key={site.id} className={styles.source}>
                  {site.href ? (
                    <a href={site.href} target="_blank" rel="noopener noreferrer">
                      {site.title}
                    </a>
                  ) : (
                    <span>{site.title}</span>
                  )}
                  <small>{site.urlLabel}</small>
                  {site.snippet ? <p>{site.snippet}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
