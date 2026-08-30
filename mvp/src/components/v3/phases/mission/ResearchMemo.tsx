import type { ReactNode } from "react";
import {
  chipHost,
  faviconSrc,
  parseInline,
  parseResearchMemo,
  type MemoInline,
  type MemoSource,
} from "./memoMarkdown";
import type { ApodexVerdictTone } from "./apodexRunMap";
import { useUiLang } from "../../../../lib/useUiLang";
import styles from "./ResearchMemo.module.css";

export type ResearchMemoProps = {
  markdown: string;
  sources?: MemoSource[];
  /** 判定档位：给判定句（首个段落的首个 strong）联动判断色标记 */
  tone?: ApodexVerdictTone;
};

function CiteChip({ label, href, extra }: { label: string; href?: string; extra?: string }) {
  const host = chipHost(label, href);
  const icon = faviconSrc(href);
  const inner = (
    <>
      {icon ? <img src={icon} alt="" width={12} height={12} /> : null}
      <span>{host || label}</span>
      {extra ? <span className={styles.chipExtra}>+{extra}</span> : null}
    </>
  );
  if (href) {
    return (
      <a className={styles.chip} href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <span className={styles.chip}>{inner}</span>;
}

function Inline({ spans, sources }: { spans: MemoInline[]; sources?: MemoSource[] }) {
  const nodes: ReactNode[] = [];
  spans.forEach((span, i) => {
    if (span.kind === "text") {
      nodes.push(span.text);
      return;
    }
    if (span.kind === "strong") {
      nodes.push(<strong key={i}>{span.text}</strong>);
      return;
    }
    if (span.kind === "chip") {
      nodes.push(<CiteChip key={i} label={span.label} href={span.href} extra={span.extra} />);
      return;
    }
    const src = sources?.[span.n - 1];
    nodes.push(
      <CiteChip
        key={i}
        label={src?.title || String(span.n)}
        href={src?.url}
      />
    );
  });
  return <>{nodes}</>;
}

function Cell({ text, sources }: { text: string; sources?: MemoSource[] }) {
  return <Inline spans={parseInline(text)} sources={sources} />;
}

export function ResearchMemo({ markdown, sources, tone }: ResearchMemoProps) {
  const { copy } = useUiLang();
  const blocks = parseResearchMemo(markdown);
  let leadStyled = false;
  return (
    <div className={styles.memo}>
      {blocks.map((block, i) => {
        if (block.type === "h1") return <h1 key={i}>{block.text}</h1>;
        if (block.type === "h2") return <h2 key={i}>{block.text}</h2>;
        if (block.type === "h3") return <h3 key={i}>{block.text}</h3>;
        if (block.type === "hr") return <hr key={i} />;
        if (block.type === "p") {
          // 判定句 = 全 memo 第一个段落（composeResearchMemo 把判定词放在首个 strong）
          const isLead = tone !== undefined && !leadStyled;
          if (isLead) leadStyled = true;
          return (
            <p key={i} className={isLead ? styles.verdictLead : undefined} data-verdict={isLead ? tone : undefined}>
              <Inline spans={block.spans} sources={sources} />
            </p>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline spans={item} sources={sources} />
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "table") {
          return (
            <div key={i} className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    {block.headers.map((h, j) => (
                      <th key={j}>
                        <Cell text={h} sources={sources} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((c, cidx) => (
                        <td key={cidx}>
                          <Cell text={c} sources={sources} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type !== "refs") return null;
        return (
          <section key={i} className={styles.refs} aria-label={copy.references}>
            <p className={styles.refsKicker}>{copy.references}</p>
            <ol>
              {block.items.map((item) => (
                <li key={item.n}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    <span>{item.title}</span>
                  )}
                  {item.host ? <span className={styles.refHost}>{item.host}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
