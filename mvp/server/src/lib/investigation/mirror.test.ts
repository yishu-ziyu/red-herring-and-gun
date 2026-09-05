import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 镜像守卫（生产侧）：本目录 schema/build/invariants/index 是
 * packages/core/src/investigation 的同内容镜像。部署只打包 mvp/，
 * server 不能运行时依赖工作区包，因此以字节级一致保证「两份不漂移」。
 * 改动契约必须两侧同步，否则此测试红。
 */
const FILES = ["schema.ts", "build.ts", "invariants.ts", "index.ts"] as const;

function repoRoot(): string {
  for (const root of [process.cwd(), join(process.cwd(), ".."), join(process.cwd(), "..", "..")]) {
    if (
      existsSync(join(root, "packages", "core", "src", "investigation", "schema.ts")) &&
      existsSync(join(root, "mvp", "server", "src", "lib", "investigation", "schema.ts"))
    ) {
      return root;
    }
  }
  return process.cwd();
}

const ROOT = repoRoot();

describe("investigation 契约镜像一致性（mvp/server 侧）", () => {
  for (const file of FILES) {
    it(`${file} 与 packages/core 源文件字节一致`, () => {
      const mirror = readFileSync(join(ROOT, "mvp", "server", "src", "lib", "investigation", file), "utf8");
      const core = readFileSync(join(ROOT, "packages", "core", "src", "investigation", file), "utf8");
      expect(mirror).toBe(core);
    });
  }
});
