/**
 * jsonSnapshot — 内存 Map 的防抖 JSON 落盘（D1：重启全丢）。
 *
 * 设计：单实例部署够用。启动时 loadSnapshot 恢复；每次变更 saveSnapshotDebounced
 * 打脏标记，2 秒后原子写（tmp + rename）。进程退出前必须 flushSnapshots()，
 * 否则窗口内的变更丢失。DATA_DIR 默认 cwd/.data，docker-compose 挂卷到该路径。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), ".data");

const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function loadSnapshot<T>(file: string): T | null {
  try {
    const raw = readFileSync(join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function flushSnapshots(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("[snapshot] 数据目录不可用，本次落盘跳过", e);
    return;
  }
  for (const [name, value] of pending) {
    const target = join(DATA_DIR, name);
    const tmp = `${target}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(value));
      renameSync(tmp, target);
    } catch (e) {
      console.error(`[snapshot] ${name} 写入失败`, e);
    }
  }
  pending.clear();
}

export function saveSnapshotDebounced(file: string, value: unknown): void {
  pending.set(file, value);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushSnapshots();
  }, 2000);
  // 不阻止进程退出（测试/脚本）；正式退出路径由 index.ts 的 SIGTERM 钩子兜底
  timer.unref?.();
}

type SnapshotSource = { file: string; serialize: () => unknown };
const sources: SnapshotSource[] = [];

/** 变更点分散的存储（账号/配额）注册为快照源，由周期循环统一落盘 */
export function registerSnapshotSource(file: string, serialize: () => unknown): void {
  sources.push({ file, serialize });
}

let loop: ReturnType<typeof setInterval> | null = null;
export function startSnapshotLoop(ms = 5000): void {
  if (loop) return;
  loop = setInterval(() => {
    for (const s of sources) saveSnapshotDebounced(s.file, s.serialize());
  }, ms);
  loop.unref?.();
}
