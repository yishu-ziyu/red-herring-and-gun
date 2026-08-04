/**
 * citationFormatter.ts — Plan P2-1 · APA / MLA 引用格式
 *
 * 借鉴秘塔学术模式 / Zotero 的引用输出格式。
 * 用于学术研究模式（pipeline.ts mode="research"）下导出。
 */

import type { Paper } from "./academicSearch";

/** APA 7th Edition 格式：Author, A. A. (Year). Title. Venue. https://doi.org/DOI */
export function formatAPA(paper: Paper): string {
  const authors = formatAuthorsAPA(paper.authors);
  const venue = paper.venue ? `. ${paper.venue}` : "";
  return `${authors} (${paper.year}). ${paper.title}${venue}. https://doi.org/${paper.doi}`;
}

/** MLA 9th Edition 格式：Author Last, First. "Title." Venue, Year, doi:DOI. */
export function formatMLA(paper: Paper): string {
  const authors = formatAuthorsMLA(paper.authors);
  const venue = paper.venue ? `, ${paper.venue}` : "";
  return `${authors}. "${paper.title}."${venue}, ${paper.year}, doi:${paper.doi}.`;
}

/** Chicago Author-Date 格式 */
export function formatChicago(paper: Paper): string {
  const authors = formatAuthorsAPA(paper.authors);
  return `${authors}. ${paper.year}. "${paper.title}." ${paper.venue ?? ""}. https://doi.org/${paper.doi}.`;
}

function formatAuthorsAPA(authors: ReadonlyArray<string>): string {
  if (authors.length === 0) return "Unknown Author";
  if (authors.length === 1) return formatSingleAuthorAPA(authors[0]);
  if (authors.length === 2) {
    return `${formatSingleAuthorAPA(authors[0])}, & ${formatSingleAuthorAPA(authors[1])}`;
  }
  // 3+：列出前 N-1 + 最后一位 + ", &"
  const head = authors.slice(0, -1).map(formatSingleAuthorAPA).join(", ");
  return `${head}, & ${formatSingleAuthorAPA(authors[authors.length - 1])}`;
}

function formatSingleAuthorAPA(author: string): string {
  // "Last, First" → "Last, F."
  const parts = author.split(/,\s*/);
  if (parts.length >= 2) {
    const last = parts[0];
    const first = parts.slice(1).join(", ");
    const initials = first
      .split(/\s+/)
      .map((n) => (n[0] ? `${n[0]}.` : ""))
      .join(" ");
    return `${last}, ${initials}`.trim();
  }
  // "First Last" → "Last, F."
  const tokens = author.split(/\s+/);
  if (tokens.length === 1) return tokens[0];
  const last = tokens[tokens.length - 1];
  const first = tokens.slice(0, -1).join(" ");
  const initials = first
    .split(/\s+/)
    .map((n) => (n[0] ? `${n[0]}.` : ""))
    .join(" ");
  return `${last}, ${initials}`.trim();
}

function formatAuthorsMLA(authors: ReadonlyArray<string>): string {
  if (authors.length === 0) return "Unknown Author";
  if (authors.length === 1) {
    // 第一作者：Last, First；其他作者保留原格式
    const a = authors[0];
    const parts = a.split(/,\s*/);
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts.slice(1).join(", ")}`;
    }
    const tokens = a.split(/\s+/);
    const last = tokens[tokens.length - 1];
    const first = tokens.slice(0, -1).join(" ");
    return `${last}, ${first}`.trim();
  }
  // 2 作者：Last, First, and First Last
  // 3+ 作者：Last, First, et al.
  const first = authors[0];
  const parts = first.split(/,\s*/);
  let firstFormatted: string;
  if (parts.length >= 2) {
    firstFormatted = `${parts[0]}, ${parts.slice(1).join(", ")}`;
  } else {
    const tokens = first.split(/\s+/);
    const last = tokens[tokens.length - 1];
    const rest = tokens.slice(0, -1).join(" ");
    firstFormatted = `${last}, ${rest}`;
  }
  if (authors.length === 2) {
    return `${firstFormatted}, and ${authors[1]}`;
  }
  return `${firstFormatted}, et al.`;
}