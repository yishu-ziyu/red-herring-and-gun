/**
 * Apodex-shaped research memo: headings, layers, tables, inline cite chips.
 * First sentence answers the claim directly. Do not stamp 能信 / 不能信.
 */

export type MemoInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "chip"; label: string; href?: string; extra?: string }
  | { kind: "ref"; n: number };

export type MemoBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "p"; spans: MemoInline[] }
  | { type: "list"; ordered: boolean; items: MemoInline[][] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "refs"; items: Array<{ n: number; title: string; url?: string; host?: string }> };

export type MemoSource = { title: string; url?: string };

export function looksLikeResearchMemo(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/^\|.+\|/m.test(t)) return true;
  if (/^REFERENCES\b/im.test(t)) return true;
  const paras = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return paras >= 3 && t.length > 280;
}

const FACE_ALT = "只能信一部分|有真有假|部分成立|还查不清|不能信|这次没查完|能信";
const FACE_TOKEN = `(?:\\*\\*)?(?:${FACE_ALT})[。．.]?(?:\\*\\*)?[。．.]?[ \\t]*`;

export function stripFaceStamp(text: string): string {
  if (!text) return "";
  let t = text.trim();
  t = t.replace(new RegExp(`(##\\s*核心结论\\s*\\n+)${FACE_TOKEN}`), "$1");
  t = t.replace(new RegExp(`^${FACE_TOKEN}`), "");
  return t.trim();
}

function emphasizeFirstSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("**")) return t;
  const m = t.match(/^(.{1,40}?[。！？])([\s\S]*)$/u);
  if (m) return `**${m[1]}**${m[2] ? ` ${m[2].trim()}` : ""}`;
  // 首句过长（常因内联引用撑爆 40 字）时，退而强调冒号前的短判决从句：
  // 「该说法无法核查：未指明…」→ 放大「该说法无法核查：」，判决仍是第一视觉主角。
  const cm = t.match(/^([^。！？：；「」]{4,24}[：:])([\s\S]*)$/u);
  if (cm) return `**${cm[1]}**${cm[2] ? ` ${cm[2].trim()}` : ""}`;
  return t;
}

export function stripLeadingVerdictEcho(text: string | undefined, label: string): string {
  if (!text) return "";
  const labels = [label, "不能信", "能信", "有真有假", "部分成立", "只能信一部分", "还查不清", "这次没查完"].filter(Boolean);
  let t = stripFaceStamp(text);
  t = t.replace(/^\*\*/, "").replace(/\*\*$/, "");
  for (const p of labels) {
    t = t.replace(new RegExp(`^(?:${p}[。．\\.\\s]*)+`), "");
  }
  return t.trim();
}

function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extraCount(label: string): { label: string; extra?: string } {
  const m = label.trim().match(/^(.*?)(?:\s*\+(\d+)\s*)$/);
  if (!m) return { label: label.trim() };
  return { label: m[1].trim(), extra: m[2] };
}

export function parseInline(text: string): MemoInline[] {
  const out: MemoInline[] = [];
  const re = /(\*\*([^*]+)\*\*|\[(\d+)\]|\[([^\]]+)\]\((https?:[^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[2]) {
      out.push({ kind: "strong", text: match[2] });
    } else if (match[3]) {
      out.push({ kind: "ref", n: Number(match[3]) });
    } else if (match[4] && match[5]) {
      const { label, extra } = extraCount(match[4]);
      out.push({ kind: "chip", label, href: match[5], extra });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.filter((s) => s.kind !== "text" || s.text.length > 0);
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isSepRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && /---/.test(line);
}

function parseRefs(chunk: string): MemoBlock {
  const items: Array<{ n: number; title: string; url?: string; host?: string }> = [];
  const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
  let i = 0;
  if (lines[0] && /^REFERENCES\b/i.test(lines[0])) i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const n = Number(m[1]);
    let rest = m[2].trim();
    let url: string | undefined;
    const md = rest.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
    if (md) {
      rest = md[1];
      url = md[2];
    } else {
      const urlMatch = rest.match(/(https?:\/\/\S+)/);
      if (urlMatch) {
        url = urlMatch[1];
        rest = rest.replace(urlMatch[1], "").trim();
      } else if (lines[i + 1] && /^https?:\/\//.test(lines[i + 1])) {
        i += 1;
        url = lines[i].trim();
      }
    }
    items.push({ n, title: rest || url || String(n), url, host: hostOf(url) });
    i += 1;
  }
  return { type: "refs", items };
}

export function parseResearchMemo(markdown: string): MemoBlock[] {
  const text = (markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const blocks: MemoBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^REFERENCES\b/i.test(line.trim())) {
      blocks.push(parseRefs(lines.slice(i).join("\n")));
      break;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3";
      blocks.push({ type: level, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }
    if (/^\|.+\|/.test(line.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i].trim())) {
        if (!isSepRow(lines[i])) rows.push(splitRow(lines[i]));
        i += 1;
      }
      if (rows.length > 0) {
        const headers = rows[0];
        const body = rows.slice(1);
        blocks.push({ type: "table", headers, rows: body });
      }
      continue;
    }
    const listMatch = line.match(/^(\d+\.|-|\*)\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1]);
      const items: MemoInline[][] = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^(\d+\.|-|\*)\s+(.+)$/);
        if (!lm) break;
        if (ordered !== /^\d+\./.test(lm[1])) break;
        items.push(parseInline(lm[2]));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (/^(#{1,3})\s/.test(next)) break;
      if (/^---+$/.test(next.trim())) break;
      if (/^\|.+\|/.test(next.trim())) break;
      if (/^(\d+\.|-|\*)\s+/.test(next)) break;
      if (/^REFERENCES\b/i.test(next.trim())) break;
      para.push(next);
      i += 1;
    }
    blocks.push({ type: "p", spans: parseInline(para.join(" ").replace(/\s+/g, " ").trim()) });
  }
  return blocks;
}

export function composeResearchMemo(input: {
  verdictLabel: string;
  conclusion?: string;
  findings?: string[];
  sources?: MemoSource[];
  /** 核查路径：六步流水线各自的量化产出，让「怎么查的」随结论一起被看见/转发 */
  path?: Array<{ label: string; detail?: string }>;
}): string {
  const raw = (input.conclusion ?? "").trim();
  const stripped = stripFaceStamp(raw);
  if (looksLikeResearchMemo(stripped)) return stripped;
  if (looksLikeResearchMemo(raw)) return stripped || raw;
  const lead = emphasizeFirstSentence(stripLeadingVerdictEcho(stripped, input.verdictLabel));
  const lines: string[] = [];
  // 备忘不再以被核查原句作 h1：放大谣言等于给谣言做暗示（错觉真相效应），
  // 而「能信/不能信」四字章又违反直接回答标准。首屏主角 = 结论首句（判决句）。
  // 原句的唯一一次回声保留在顶部气泡。
  lines.push("## 核心结论", "");
  if (lead) {
    lines.push(lead, "");
  }
  const findings = (input.findings ?? []).map((f) => f.trim()).filter(Boolean);
  if (findings.length > 0) {
    findings.forEach((f, i) => {
      lines.push(`${i + 1}. ${f}`);
    });
    lines.push("");
  }
  const path = (input.path ?? []).filter((p) => p.label.trim());
  if (path.length > 0) {
    lines.push("## 核查路径", "");
    path.forEach((p) => {
      lines.push(`- ✓ ${p.detail ? `${p.label} · ${p.detail}` : p.label}`);
    });
    lines.push("");
  }
  const sources = (input.sources ?? []).filter((s) => s.title || s.url);
  if (sources.length > 0) {
    lines.push("REFERENCES", "");
    sources.forEach((s, i) => {
      const title = s.title || s.url || `来源 ${i + 1}`;
      if (s.url) lines.push(`${i + 1}. [${title}](${s.url})`);
      else lines.push(`${i + 1}. ${title}`);
    });
  }
  return lines.join("\n").trim();
}

export function faviconSrc(url?: string): string | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

export function chipHost(label: string, href?: string): string {
  return hostOf(href) || label.replace(/\s*\+\d+\s*$/, "");
}
