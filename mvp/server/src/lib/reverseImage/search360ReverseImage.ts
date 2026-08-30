/**
 * search360ReverseImage.ts — 360 智搜-图搜图 reverse-image 适配器（官方文档）。
 *
 * 端点：POST https://api.360.cn/saas/vertical?q=&ref_prom=360so-v-ig
 * 鉴权：Authorization: Bearer <QIHOO_360_API_KEY>
 * Body：{ img_url: "<公网可访问的原图地址>" }
 *
 * 图片来自用户上传的 dataUrl；本适配器先落盘到服务端临时图床（/uploads 静态目录），
 * 拼出公网 URL 后调 360。失败 / 无命中 → 返回 []，上层优雅降级为「原图没查到」，
 * 绝不把 OCR / 文字检索二手帖当成图源（该纪律由 lib/imageOrigin 闸门保证）。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fetchWithTimeout } from "../httpUtils.js";
import type {
  ImagePayload,
  ReverseImageHit,
  ReverseImageSearchFn,
} from "../imageOrigin/imageOrigin.js";

const SEARCH360_VENDOR_URL = "https://api.360.cn/saas/vertical";
const SAAS_REF_PROM = "360so-v-ig";
const UPLOAD_TTL_MS = 60 * 60 * 1000; // 临时图床文件 1h 后由下次上传清理

/** 合法的 dataUrl：data:image/<mime>;base64,<bytes> */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] || "png";
}

export function resolveUploadDir(env: Record<string, string>): string {
  return env.UPLOAD_DIR || join(env.RHG_DATA_DIR || tmpdir(), "rhg-uploads");
}

/** 公网可访问的 base URL：生产配 PUBLIC_BASE_URL=https://gun.yishuziyu.cn，本地默认 127.0.0.1:3000。 */
function publicBaseUrl(env: Record<string, string>): string | undefined {
  const raw = env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

/**
 * dataUrl → 服务端临时文件，返回可公网访问的 img_url。
 * 失败返回 undefined（不抛），调用方跳过这张图。
 */
export async function uploadImageForReverseSearch(
  env: Record<string, string>,
  dataUrl: string
): Promise<string | undefined> {
  const base = publicBaseUrl(env);
  if (!base) return undefined;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return undefined;
  const dir = resolveUploadDir(env);
  const filename = `rhg-${Date.now()}-${randomUUID().slice(0, 8)}.${mimeToExt(decoded.mime)}`;
  try {
    await mkdir(dir, { recursive: true });
    // 顺带清理过期文件，防堆积
    await sweepExpired(dir);
    await writeFile(join(dir, filename), decoded.buffer);
    return `${base}/uploads/${filename}`;
  } catch {
    return undefined;
  }
}

async function sweepExpired(dir: string): Promise<void> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    const now = Date.now();
    await Promise.all(
      entries
        .filter((name) => name.startsWith("rhg-"))
        .map(async (name) => {
          const file = await import("node:fs/promises");
          const stat = await file.stat(join(dir, name));
          if (now - stat.mtimeMs > UPLOAD_TTL_MS) await rm(join(dir, name), { force: true });
        })
    );
  } catch {
    /* 清理失败不影响主流程 */
  }
}

function get360ApiKey(env: Record<string, string>): string {
  return (
    env.QIHOO_360_API_KEY ||
    env.ZHINAO_API_KEY ||
    env.AI360_API_KEY ||
    process.env.QIHOO_360_API_KEY ||
    process.env.ZHINAO_API_KEY ||
    process.env.AI360_API_KEY ||
    ""
  );
}

/** 宽容解析 360 图搜响应：递归收集「对象含 http(s) url + 就近 title」的命中。响应结构未公开，故做深度遍历而非绑定字段。 */
export function parse360ReverseHits(data: unknown): ReverseImageHit[] {
  if (typeof data === "string") {
    try {
      return parse360ReverseHits(JSON.parse(data));
    } catch {
      return [];
    }
  }
  const out: ReverseImageHit[] = [];
  const seen = new Set<string>();

  const walk = (value: unknown, nearTitle: string): void => {
    if (out.length >= 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, nearTitle);
      return;
    }
    const rec = value as Record<string, unknown>;
    let title = nearTitle;
    for (const [key, item] of Object.entries(rec)) {
      if (/^(title|name|sourceName|siteName)$/i.test(key) && typeof item === "string" && item.trim()) {
        title = item.trim();
      }
    }
    for (const [key, item] of Object.entries(rec)) {
      if (/^(url|imgUrl|imageUrl|pageUrl|link|from|host|source)$/i.test(key) && typeof item === "string") {
        const url = item.trim();
        if (/^https?:\/\//i.test(url) && !seen.has(url)) {
          seen.add(url);
          out.push({ url: url.slice(0, 500), title: title.slice(0, 200) });
          if (out.length >= 12) return;
        }
      }
    }
    for (const item of Object.values(rec)) {
      walk(item, title);
    }
  };
  walk(data, "");
  return out;
}

/**
 * 对每张图走一遍 360 图搜；任一张失败只跳过该图，不阻断。
 * 生产要生效需配 QIHOO_360_API_KEY 与 PUBLIC_BASE_URL。
 */
export function makeSearch360ReverseImage(env: Record<string, string>): ReverseImageSearchFn | undefined {
  const apiKey = get360ApiKey(env);
  if (!apiKey || !publicBaseUrl(env)) return undefined;
  return async ({ images }) => {
    const hits: ReverseImageHit[] = [];
    for (const image of images.slice(0, 4)) {
      const imgUrl = await uploadImageForReverseSearch(env, image.dataUrl);
      if (!imgUrl) continue;
      try {
        const response = await fetchWithTimeout(
          `${SEARCH360_VENDOR_URL}?q=&ref_prom=${SAAS_REF_PROM}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ img_url: imgUrl }),
          },
          20000,
          "360 智搜-图搜图"
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) continue;
        hits.push(...parse360ReverseHits(data));
      } catch {
        continue;
      }
    }
    return hits;
  };
}

export function isReverseImageVendorConfigured(env: Record<string, string>): boolean {
  return Boolean(get360ApiKey(env)) && Boolean(publicBaseUrl(env));
}