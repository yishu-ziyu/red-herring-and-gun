/**
 * videoFrames.ts — 短视频抽帧（浏览器端）。
 *
 * 视频不做整体核查，而是抽 3 帧转成图片走既有 image 管线：
 * 帧 → StepFun Vision（OCR / 画面主体 / 来源线索）→ 并行检索 / 以图搜图。
 * 抽帧在浏览器完成，服务端零改动，避免大文件 base64 传输。
 */
import type { CaseImage } from "./caseIntake";

const MAX_FRAMES = 3;
const JPEG_QUALITY = 0.72;

function loadVideoMeta(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("视频无法解码，请换一个文件。"));
  });
}

function frameAt(video: HTMLVideoElement, time: number): string | null {
  const width = Math.min(video.videoWidth || 1280, 1280);
  const scale = width / (video.videoWidth || width);
  const height = Math.round((video.videoHeight || 720) * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  try {
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null;
  }
}

/**
 * 抽取视频 MAX_FRAMES 帧（均匀分布在时长轴上），返回可直接进 CaseImage 管线的帧。
 * 失败返回空数组。
 */
let frameSeq = 0;
export async function extractFramesFromVideo(file: File, count: number = MAX_FRAMES): Promise<CaseImage[]> {
  if (!/^video\//i.test(file.type)) return [];
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideoMeta(url);
    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        resolve();
      };
      if (video.readyState >= 2) resolve();
      else {
        video.addEventListener("loadeddata", onReady);
        video.currentTime = 0.01;
      }
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const times = Array.from(
      { length: count },
      (_, index) => (duration * (index + 0.5)) / count
    );
    const frames: string[] = [];
    for (const time of times) {
      video.currentTime = Math.min(time, duration - 0.01);
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });
      const dataUrl = frameAt(video, time);
      if (dataUrl) frames.push(dataUrl);
    }
    const bytesOf = (dataUrl: string) => Math.round((dataUrl.split(",")[1]?.length || 0) * 0.75);
    return frames.map((dataUrl, index) => ({
      id: `frame-${Date.now()}-${frameSeq++}`,
      name: `[视频帧 ${index + 1}/${frames.length}] ${file.name}`,
      type: "image/jpeg",
      size: bytesOf(dataUrl),
      dataUrl,
    }));
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}