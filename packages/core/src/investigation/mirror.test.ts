import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 镜像守卫：packages/core/src/investigation 是唯一契约源文件；
 * 生产 mvp/server/src/lib/investigation 是同内容镜像（部署只打包 mvp/，
 * server 不能运行时依赖工作区包）。任何单侧改动必须两侧同步，否则此测试红。
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

describe("investigation 契约镜像一致性", () => {
  for (const file of FILES) {
    it(`${file} 与生产镜像字节一致`, () => {
      const core = readFileSync(join(ROOT, "packages", "core", "src", "investigation", file), "utf8");
      const mirror = readFileSync(join(ROOT, "mvp", "server", "src", "lib", "investigation", file), "utf8");
      expect(mirror).toBe(core);
    });
  }
});
