/**
 * shareLongImage.ts — 把核查结论画成一张可分享的长图（PNG）。
 * 用原生 canvas 排版：标题 / 原句 / 判定 / 分数 / 时间。不引第三方库。
 */

export interface ShareLongImageInput {
  claim: string;
  verdictLabel: string;
  score?: number;
  timestamp: number;
  sources?: Array<{ title?: string; url?: string }>;
}

const W = 720;
const PAD = 40;
const LINE = 46;

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number, name: string): string[] {
  const lines: string[] = [];
  const maxChars = Math.max(8, Math.floor(width / 15)); // 中文字宽近似 15px
  for (const raw of text.split(/\n/)) {
    for (let i = 0; i < raw.length; i += maxChars) {
      lines.push(raw.slice(i, i + maxChars));
    }
  }
  return lines.slice(0, name === "body" ? 14 : 6);
}

export function createShareLongImage(input: ShareLongImageInput & { sources?: Array<{ title?: string; url?: string }> }): string {
  const rowCount = 4 + Math.floor(input.claim.length / 46) + (input.sources?.length ?? 0) * 2;
  const height = Math.max(460, PAD * 2 + rowCount * LINE + 120);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // 纸底
  ctx.fillStyle = "#faf7f2";
  ctx.fillRect(0, 0, W, height);

  let y = PAD;
  ctx.fillStyle = "#1f1b2e";
  ctx.font = "700 30px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText("红鲱鱼与枪 · 信息真相核查", PAD, y);
  y += 44;

  // 原句
  ctx.fillStyle = "#6e6880";
  ctx.font = "300 15px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText("待核查的说法", PAD, y + 8);
  y += 34;
  ctx.fillStyle = "#2c2738";
  ctx.font = "400 17px -apple-system, 'PingFang SC', sans-serif";
  for (const line of wrapText(ctx, input.claim, W - PAD * 2, "body")) {
    ctx.fillText(line, PAD, y);
    y += 30;
  }
  y += 16;

  // 分界
  ctx.strokeStyle = "#e4e1ec";
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 30;

  // 判定
  ctx.fillStyle = "#3a5f8f";
  ctx.font = "600 26px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText(String(input.verdictLabel || "unverified").replace("_", " · "), PAD, y);
  y += 36;
  if (typeof input.score === "number") {
    ctx.fillStyle = "#6e6880";
    ctx.font = "300 15px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText(`可信度 ${input.score}/100`, PAD, y);
  }
  y += 36;

  // 来源
  const sources = input.sources ?? [];
  if (sources.length > 0) {
    ctx.fillStyle = "#6e6880";
    ctx.font = "300 14px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText("来源（可点开核对）", PAD, y + 8);
    y += 32;
    ctx.fillStyle = "#2c2738";
    ctx.font = "400 14px -apple-system, 'PingFang SC', sans-serif";
    for (const s of sources.slice(0, 6)) {
      ctx.fillText(`· ${(s.title || s.url || "").slice(0, 56)}`, PAD, y);
      y += 24;
    }
    y += 10;
  }

  // 时间
  ctx.fillStyle = "#9a93ad";
  ctx.font = "300 13px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText(`核查于 ${new Date(input.timestamp).toLocaleString()}`, PAD, height - PAD);

  return canvas.toDataURL("image/png");
}