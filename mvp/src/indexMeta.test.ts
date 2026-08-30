import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public page metadata", () => {
  it("describes the user's fact-checking outcome instead of the internal Agent architecture", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain("红鲱鱼与枪｜查出处，判断原句哪里站得住");
    expect(html).toContain("输入一句话、链接或截图");
    expect(html).not.toMatch(/多\s*Agent|AI事实核查 Agent/i);
  });
});
