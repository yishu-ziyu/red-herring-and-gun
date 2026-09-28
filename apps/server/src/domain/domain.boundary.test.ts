import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 架构守卫：domain/ 是业务规则，不得依赖模型、网络、存储、HTTP 或 lib/ 里的任何实现。
 * 只允许 domain/ 内部相互引用（测试文件可以引用测试框架与 node 内置模块）。
 */
const DIR = join(process.cwd(), "server", "src", "domain");

describe("domain 边界", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

  it("至少有一个业务规则文件", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} 只引用 domain/ 内部模块`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      const imports = [...source.matchAll(/(?:import|export)[^'"]*from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
        (match) => match[1] ?? match[2]
      );
      const outside = imports.filter((path) => !path.startsWith("./"));
      expect(outside).toEqual([]);
      expect(source).not.toMatch(/\b(fetch|process\.env|require)\s*\(/);
    });
  }
});
