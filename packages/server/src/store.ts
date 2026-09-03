import { mkdir, readdir, readFile, appendFile, access } from "node:fs/promises";
import { join } from "node:path";
import { replay, validateEvent, type CaseEvent } from "@rhg/core";

export type CaseListItem = {
  caseId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  verdictType?: string;
};

export type CaseStore = {
  append(caseId: string, events: readonly CaseEvent[]): Promise<void>;
  load(caseId: string): Promise<CaseEvent[] | null>;
  list(): Promise<CaseListItem[]>;
};

const ID_RE = /^[A-Za-z0-9._-]+$/;

function fileOf(dir: string, caseId: string): string {
  if (!ID_RE.test(caseId)) throw new Error("invalid case id");
  return join(dir, `${caseId}.jsonl`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class FileCaseStore implements CaseStore {
  constructor(private readonly dir: string) {}

  async append(caseId: string, events: readonly CaseEvent[]): Promise<void> {
    if (events.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await appendFile(fileOf(this.dir, caseId), lines, "utf8");
  }

  async load(caseId: string): Promise<CaseEvent[] | null> {
    const path = fileOf(this.dir, caseId);
    if (!(await exists(path))) return null;
    const text = await readFile(path, "utf8");
    const events: CaseEvent[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      events.push(validateEvent(JSON.parse(line) as unknown));
    }
    return events;
  }

  async list(): Promise<CaseListItem[]> {
    // ponytail: list 逐文件 replay，O(n)；升级路径是旁路索引文件。
    if (!(await exists(this.dir))) return [];
    const names = (await readdir(this.dir)).filter((name) => name.endsWith(".jsonl"));
    const items: CaseListItem[] = [];
    for (const name of names) {
      const caseId = name.slice(0, -".jsonl".length);
      const events = await this.load(caseId);
      if (!events || events.length === 0) continue;
      const folded = replay(events);
      const last = events[events.length - 1];
      const item: CaseListItem = {
        caseId,
        text: folded.text,
        createdAt: folded.createdAt,
        updatedAt: last?.at ?? folded.createdAt,
      };
      const overall = folded.overall;
      if (overall !== undefined) item.verdictType = overall.verdictType;
      items.push(item);
    }
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return items;
  }
}
