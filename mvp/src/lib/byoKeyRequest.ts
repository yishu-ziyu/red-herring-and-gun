/**
 * byoKeyRequest.ts — 发起调查时读取本地保存的 BYO 配置。
 *
 * 与模型设置页（ApiKeySettings）共用同一份 localStorage 存储（key: gun-byo-key，
 * 值为 base64 编码的 JSON）。本模块只读不写：未保存或数据损坏时返回 null，
 * 请求体保持与现状完全一致（行为零变化）。
 */

export const BYO_KEY_STORAGE_KEY = "gun-byo-key";

export interface ByoKeyPayload {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/** 与设置页同一套编码：base64 只是避免明文直接落盘，不是加密。 */
export function obfuscateByoKey(value: ByoKeyPayload): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function deobfuscate(raw: string): ByoKeyPayload | null {
  try {
    const decoded = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.baseUrl === "string" &&
      typeof parsed.apiKey === "string" &&
      typeof parsed.modelName === "string"
    ) {
      return parsed as ByoKeyPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** 读本地保存的 BYO 配置；未保存、损坏或三项任一为空都视为没有配置。 */
export function readSavedByoKey(): ByoKeyPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BYO_KEY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = deobfuscate(raw);
    if (!parsed) return null;
    if (!parsed.baseUrl.trim() || !parsed.apiKey.trim() || !parsed.modelName.trim()) return null;
    return parsed;
  } catch {
    // 隐私模式下访问 localStorage 可能抛错：视为没有保存过密钥。
    return null;
  }
}
