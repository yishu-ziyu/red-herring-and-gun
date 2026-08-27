import { describe, expect, it } from "vitest";
import { INVESTIGATOR_SYSTEM_PROMPT } from "./prompt";

describe("INVESTIGATOR_SYSTEM_PROMPT headings", () => {
  it("asks for Apodex-shaped finding titles, not a school outline", () => {
    expect(INVESTIGATOR_SYSTEM_PROMPT).toContain("## 核心结论");
    expect(INVESTIGATOR_SYSTEM_PROMPT).toContain("一、已发生的事实：2026 年上半年无一降息");
    expect(INVESTIGATOR_SYSTEM_PROMPT).toContain("一、机制：加热不会凭空产生亚硝胺");
    expect(INVESTIGATOR_SYSTEM_PROMPT).toContain("错：## 一、问题拆三层");
    expect(INVESTIGATOR_SYSTEM_PROMPT).not.toContain("分层的 ## 一、二、三");
  });
});
