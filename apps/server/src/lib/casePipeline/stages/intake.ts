/**
 * 阶段 0 读材料：把链接正文和图片里读出的内容拼进给模型看的调查文本。
 * 图片读不出来不拖垮整次调查：有文字就按文字继续并留常驻提示；没有文字就明说，不假装查过。
 */
import type { RunRecorder } from "../../runRecorder.js";
import { asRecord } from "../../valueCoerce.js";
import {
  callStepFunVisionForIntake,
  composeClaimWithLinks,
  composeClaimWithVision,
  imageTextForDisplay,
  type CaseIntakePayload,
} from "../../visionIntake.js";

/** 每次读图的时限；失败只重试一次。模型路由里视觉模型自己的单次时限更长，以这里为准。 */
const IMAGE_READ_TIMEOUT_MS = 60_000;
const VISION_TOOL = { toolName: "Image Reading", query: "图片材料解析" } as const;
const IMAGE_UNREADABLE_NOTICE = "图片没能读出来，已按你输入的文字继续";
export const IMAGE_UNREADABLE_ONLY_MESSAGE = "图片没能读出来，这次没法核查。请换一张更清晰的图，或把图里的文字打出来再试。";

/** 只有图片、图片又没读出来：没有可核查的内容。 */
export class ImageUnreadableError extends Error {
  constructor() {
    super("image-unreadable");
    this.name = "ImageUnreadableError";
  }
}

export type IntakeResult = {
  /** 给模型看的调查文本：用户原话 + 链接正文 + 视觉提取。 */
  claim: string;
  /** 「你调查的说法」：用户原话；只交了图片时是图里读出的文字。 */
  displayClaim: string;
  /** 用户自己写的配文，不含任何拼进来的材料；截图语境核查拿它和视觉提取对比。 */
  caption: string;
  visualExtraction?: Record<string, unknown>;
  notices: Array<{ code: string; message: string }>;
};

export async function readIntake(input: {
  runId: string;
  env: Record<string, string>;
  claim: string;
  intake: CaseIntakePayload | null;
  signal: AbortSignal;
  deadlineMs: number;
  recorder: RunRecorder;
  publish: (event: Record<string, unknown>) => void;
}): Promise<IntakeResult> {
  const { runId, env, intake, signal, deadlineMs, recorder, publish } = input;
  const result: IntakeResult = {
    claim: composeClaimWithLinks(input.claim, intake),
    displayClaim: input.claim,
    caption: intake ? intake.text.trim() : input.claim,
    notices: [],
  };
  if (!intake?.images.length) return result;

  publish({ type: "tool_start", ...VISION_TOOL, timestamp: Date.now() });
  const readImage = async () => {
    const attemptId = recorder.startAttempt({ stage: "vision", input: { claim: result.claim, intake } });
    try {
      const vision = await callStepFunVisionForIntake({
        env, claim: result.claim, intake, signal,
        deadlineMs: Math.min(deadlineMs, Date.now() + IMAGE_READ_TIMEOUT_MS),
      });
      recorder.finishAttempt(attemptId, { status: "succeeded", output: vision.output, model: vision.model });
      return vision;
    } catch (error) {
      recorder.finishAttempt(attemptId, { status: signal.aborted ? "cancelled" : "failed", error: String(error) });
      throw error;
    }
  };
  try {
    // 视觉模型偶尔失败一次：重试一次再算读不出来。取消、总时限到了不重试。
    const vision = await readImage().catch((error) => {
      signal.throwIfAborted();
      if (Date.now() >= deadlineMs) throw error;
      console.warn(`[vision] 图片解析失败，重试一次 runId=${runId}: ${error instanceof Error ? error.message : String(error)}`);
      return readImage();
    });
    const visualExtraction = asRecord(vision.output);
    result.visualExtraction = visualExtraction;
    result.claim = composeClaimWithVision(result.claim, intake, visualExtraction);
    if (!intake.text.trim()) result.displayClaim = imageTextForDisplay(visualExtraction);
    publish({
      type: "tool_result",
      ...VISION_TOOL,
      model: vision.model,
      result: { _source: "vision", ...visualExtraction },
      timestamp: Date.now(),
    });
  } catch (error) {
    publish({
      type: "tool_error",
      ...VISION_TOOL,
      error: error instanceof Error ? error.message : "图片材料解析失败",
      timestamp: Date.now(),
    });
    // 取消仍走自己的结局，不当成「图片读不出来」。
    signal.throwIfAborted();
    const hasText = intake.text.trim().length > 0 || intake.links.some((link) => Boolean(link.scrapedContent?.trim()));
    if (!hasText) throw new ImageUnreadableError();
    result.notices.push({ code: "image_unreadable", message: IMAGE_UNREADABLE_NOTICE });
  }
  return result;
}
