export interface CaseLink {
  id: string;
  url: string;
  hostname: string;
  scrapedContent?: string;
  scrapedAt?: number;
  scrapeStatus?: "success" | "error";
  scrapeError?: string;
}

export interface CaseImage {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface CaseIntake {
  text: string;
  links: CaseLink[];
  images: CaseImage[];
  createdAt: number;
}

const URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s"'<>，。；、）)]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|cn|net|org|gov|edu|io|ai|co|me|app|dev|top|xyz|info|news|site|cc|tv|hk|tw)(?:\/[^\s"'<>，。；、）)]*)?/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:，。！？；：、）)]+$/;

function createId(prefix: string) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hostnameFor(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeUrl(rawUrl: string) {
  const trimmed = rawUrl.trim().replace(TRAILING_URL_PUNCTUATION, "");
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function extractLinks(text: string): CaseLink[] {
  const seen = new Set<string>();
  const matches = text.match(URL_PATTERN) ?? [];

  return matches.reduce<CaseLink[]>((links, rawUrl) => {
    const url = normalizeUrl(rawUrl);
    if (!url || seen.has(url)) return links;
    seen.add(url);
    links.push({
      id: createId("link"),
      url,
      hostname: hostnameFor(url),
    });
    return links;
  }, []);
}

export function createCaseIntake(text: string, images: CaseImage[]): CaseIntake {
  return {
    text: text.trim(),
    links: extractLinks(text),
    images,
    createdAt: Date.now(),
  };
}

export function caseIntakeHasMaterial(intake: Pick<CaseIntake, "text" | "links" | "images">) {
  return Boolean(intake.text.trim() || intake.links.length > 0 || intake.images.length > 0);
}

export function caseIntakePrimaryText(intake: CaseIntake) {
  if (intake.text.trim()) return intake.text.trim();
  if (intake.links.length > 0) return `请核查链接内容：${intake.links.map((link) => link.url).join(" ")}`;
  if (intake.images.length > 0) return `请核查用户上传的 ${intake.images.length} 张图片材料。`;
  return "";
}

export function caseIntakeSummary(intake: CaseIntake) {
  const parts = [];
  if (intake.text.trim()) parts.push("文字");
  if (intake.links.length > 0) parts.push(`${intake.links.length} 个链接`);
  if (intake.images.length > 0) parts.push(`${intake.images.length} 张图片`);
  return parts.join(" / ") || "空材料";
}

export function imageFileToCaseImage(file: File): Promise<CaseImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }

      resolve({
        id: createId("image"),
        name: file.name,
        type: file.type || "image/*",
        size: file.size,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}
