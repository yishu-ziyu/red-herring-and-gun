import type { Evidence, Pivot } from "../casefile/schema.js";
import { webFetch } from "../fetch/webFetch.js";
import { buildVisionPrompt, type CaseIntakePayload } from "../llm/visionIntake.js";
import { tierOf } from "../rules/sourceTiers.js";
import { canonicalizeUrl } from "../search/toEvidence.js";
import type { StageContext } from "./context.js";

export type IntakeAttachment = { kind: "url" | "image"; value: string };

export type IntakeInput = {
  text: string;
  attachments?: IntakeAttachment[];
};

export type IntakeResult = { claimSource: string };

const EXCERPT_MAX = 320;

const VISION_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的视觉材料预处理。",
  "只提取图中可见文字与来源线索。只返回 JSON。",
].join("\n");

function clipExcerpt(text: string): string {
  const points = [...text];
  return points.length <= EXCERPT_MAX ? text : points.slice(0, EXCERPT_MAX).join("");
}

function firstParagraph(text: string, skip?: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (skip && trimmed === skip) continue;
    return trimmed;
  }
  return "";
}

function appendSource(base: string, extra: string): string {
  if (!extra) return base;
  if (!base) return extra;
  return `${base}\n${extra}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function nextEvidenceId(ctx: StageContext): string {
  return `e${ctx.current.evidence.length + 1}`;
}

function ocrTextsFrom(output: unknown): string[] {
  if (typeof output !== "object" || output === null || !("ocrTexts" in output)) return [];
  const texts = output.ocrTexts;
  if (!Array.isArray(texts)) return [];
  return texts.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function evidenceFromFetch(ctx: StageContext, rawUrl: string, page: {
  finalUrl: string;
  text: string;
  title?: string;
  publishedAt?: string;
  reachable: boolean;
}): Evidence {
  const url = page.finalUrl || rawUrl;
  const canonicalUrl = canonicalizeUrl(url) ?? url;
  const host = hostOf(canonicalUrl) || hostOf(url);
  const evidence: Evidence = {
    id: nextEvidenceId(ctx),
    url,
    canonicalUrl,
    host,
    excerpt: clipExcerpt(page.text),
    retrievedAt: ctx.now(),
    tier: host ? tierOf(host) : "unknown",
    reachable: page.reachable,
    provenance: { kind: "user" },
  };
  if (page.title) evidence.title = page.title;
  if (page.text) evidence.text = page.text;
  if (page.publishedAt) evidence.publishedAt = page.publishedAt;
  return evidence;
}

async function ingestUrl(ctx: StageContext, url: string, claimSource: string): Promise<string> {
  const page = await webFetch(url, { signal: ctx.signal });
  const evidence = evidenceFromFetch(ctx, url, page);
  ctx.emit({ type: "evidence.added", evidence });
  if (!page.reachable) return claimSource;
  const lede = [page.title ?? "", firstParagraph(page.text, page.title)].filter((part) => part.length > 0).join("\n");
  return appendSource(claimSource, lede);
}

async function ingestImages(ctx: StageContext, input: IntakeInput, images: string[], claimSource: string): Promise<string> {
  const origin = ctx.current.frontier.length;
  const pivots: Pivot[] = images.map((value, i) => ({
    id: `p${origin + i + 1}`,
    kind: "image" as const,
    value,
    why: "用户上传",
    expectedValue: 1 as const,
    depth: 0,
  }));
  if (pivots.length > 0) ctx.emit({ type: "frontier.added", pivots });

  // callStepFunVisionForIntake 直接打 StepFun、不走 callJob / ctx.llm；OCR 只经 ctx.llm 接入。
  const intake: CaseIntakePayload = {
    text: input.text,
    links: [],
    images: images.map((dataUrl) => ({ dataUrl })),
  };
  try {
    const result = await ctx.llm({
      job: "vision-intake",
      systemPrompt: VISION_SYSTEM_PROMPT,
      userContent: buildVisionPrompt(input.text, intake),
    });
    return appendSource(claimSource, ocrTextsFrom(result.output).join("\n"));
  } catch {
    return claimSource;
  }
}

export async function runIntake(ctx: StageContext, input: IntakeInput): Promise<IntakeResult> {
  ctx.emit({ type: "stage.started", stage: "intake" });
  const attachments = input.attachments ?? [];
  let claimSource = input.text;
  for (const item of attachments) {
    if (item.kind === "url") claimSource = await ingestUrl(ctx, item.value, claimSource);
  }
  const images = attachments.filter((item) => item.kind === "image").map((item) => item.value);
  if (images.length > 0) claimSource = await ingestImages(ctx, input, images, claimSource);
  ctx.emit({ type: "stage.finished", stage: "intake", outcome: "ok" });
  return { claimSource };
}
