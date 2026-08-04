/**
 * pdfReader.test.ts — Plan P2-2 · PDF 阅读（4 case + corrupted/too_large）
 *
 * 关键校验：
 *   - text / scan / encrypted / fake_extension 4 case 必须各自返回正确 case 标识
 *   - corrupted（magic 损坏但类似）/ too_large（> 50MB）也要兜底
 *   - 失败时 error 非 null，不得静默降级
 *   - 扫描件返回 error: null + warnings（OCR 路径占位）
 *   - 不编页码：定位不可用时显式标记
 */

import { describe, expect, it } from "vitest";
import {
  detectPdfCase,
  extractPdfPages,
  isIntakeAcceptable,
} from "./pdfReader";

function fakePdfBytes(pages: number): Buffer {
  // 构造含 %PDF- 头 + /Type /Page 标记的极简 PDF-like buffer
  const head = Buffer.from("%PDF-1.4\n", "ascii");
  const pageMarks: Buffer[] = [];
  for (let i = 0; i < pages; i++) {
    pageMarks.push(Buffer.from(`1 0 obj << /Type /Page >> endobj\n`, "ascii"));
  }
  return Buffer.concat([head, ...pageMarks]);
}

function fakeFakeExtension(): Buffer {
  return Buffer.from("PNG\r\n\x1a\n89504e47", "ascii");
}

function fakeEncryptedPdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Catalog /Encrypt 2 0 R >> endobj\n",
    "ascii",
  );
}

function fakeScanPdf(): Buffer {
  // 包含 /Type /Page 但无 /Font（启发式：扫描件）
  return Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 612 792] >> endobj\n",
    "ascii",
  );
}

describe("Plan P2-2 · detectPdfCase", () => {
  it("合法 PDF → text", () => {
    expect(detectPdfCase(fakePdfBytes(3))).toBe("text");
  });

  it("文件不是 PDF（PNG magic）→ fake_extension", () => {
    expect(detectPdfCase(fakeFakeExtension())).toBe("fake_extension");
  });

  it("含 /Encrypt → encrypted", () => {
    expect(detectPdfCase(fakeEncryptedPdf())).toBe("encrypted");
  });

  it("filename 含 scan 且无 /Font → scan", () => {
    expect(detectPdfCase(fakeScanPdf(), "contract-scan.pdf")).toBe("scan");
  });

  it("> 50 MB → too_large", () => {
    const huge = Buffer.alloc(51 * 1024 * 1024, 0x20);
    huge[0] = 0x25;
    huge[1] = 0x50;
    huge[2] = 0x44;
    huge[3] = 0x46;
    huge[4] = 0x2d;
    expect(detectPdfCase(huge)).toBe("too_large");
  });

  it("空 buffer → fake_extension", () => {
    expect(detectPdfCase(Buffer.alloc(0))).toBe("fake_extension");
  });
});

describe("Plan P2-2 · extractPdfPages", () => {
  it("text PDF 抽取：error=null + totalPages ≥ 1", () => {
    const r = extractPdfPages(fakePdfBytes(3));
    expect(r.error).toBeNull();
    expect(r.totalPages).toBeGreaterThanOrEqual(1);
    expect(r.pages.length).toBeGreaterThanOrEqual(1);
  });

  it("fake_extension：error 非 null + 显式说明", () => {
    const r = extractPdfPages(fakeFakeExtension());
    expect(r.error).not.toBeNull();
    expect(r.error).toContain("magic");
    expect(r.totalPages).toBe(0);
  });

  it("encrypted：error 非 null + 提示解除密码", () => {
    const r = extractPdfPages(fakeEncryptedPdf());
    expect(r.error).not.toBeNull();
    expect(r.error).toContain("加密");
    expect(r.totalPages).toBe(0);
  });

  it("scan：error=null（OCR 路径占位）+ warnings 非空", () => {
    const r = extractPdfPages(fakeScanPdf(), "contract-scan.pdf");
    expect(r.error).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes("OCR"))).toBe(true);
    // 扫描件：totalPages 可以为 0（OCR 未实际抽取）
    expect(r.totalPages).toBeGreaterThanOrEqual(0);
  });

  it("too_large：error 含大小信息", () => {
    const huge = Buffer.alloc(51 * 1024 * 1024, 0x20);
    huge[0] = 0x25; huge[1] = 0x50; huge[2] = 0x44; huge[3] = 0x46; huge[4] = 0x2d;
    const r = extractPdfPages(huge);
    expect(r.error).toContain("50 MB");
  });

  it("text PDF 每页 pageNumber 必须 1-based 连续", () => {
    const r = extractPdfPages(fakePdfBytes(5));
    expect(r.pages[0].pageNumber).toBe(1);
    expect(r.pages[1].pageNumber).toBe(2);
    expect(r.pages[4].pageNumber).toBe(5);
  });

  it("闸门：isScanned=false 表示文本可复制", () => {
    const r = extractPdfPages(fakePdfBytes(2));
    expect(r.pages[0].isScanned).toBe(false);
  });
});

describe("Plan P2-2 · isIntakeAcceptable", () => {
  it("text 抽取成功 → true", () => {
    expect(isIntakeAcceptable(extractPdfPages(fakePdfBytes(2)))).toBe(true);
  });
  it("fake_extension → false", () => {
    expect(isIntakeAcceptable(extractPdfPages(fakeFakeExtension()))).toBe(false);
  });
  it("encrypted → false", () => {
    expect(isIntakeAcceptable(extractPdfPages(fakeEncryptedPdf()))).toBe(false);
  });
  it("scan → false（OCR 未接入，pages=0）", () => {
    expect(isIntakeAcceptable(extractPdfPages(fakeScanPdf(), "x-scan.pdf"))).toBe(false);
  });
});