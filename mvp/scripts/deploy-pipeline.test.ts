/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const opsSh = join(repoRoot, "ops.sh");
const hashedJs = "index-Aa1Bb2Cc.js";
const hashedCss = "index-Dd3Ee4Ff.css";

function sh(args: string[], env: NodeJS.ProcessEnv = {}, cwd = repoRoot): string {
  return execFileSync("bash", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

function tarList(archive: string): string[] {
  const raw = execFileSync("tar", ["tzf", archive], { encoding: "utf8" });
  return raw
    .split("\n")
    .map((line) => line.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
}

function assertSseAndReportLocations(conf: string, label: string) {
  const sse = conf.match(/location\s+\/api\/agent\/orchestrate-stream\s*\{([\s\S]*?)\}/);
  expect(sse, `${label}: missing location /api/agent/orchestrate-stream`).toBeTruthy();
  const body = sse![1];
  expect(body, `${label}: proxy_buffering off`).toMatch(/proxy_buffering\s+off/);
  expect(body, `${label}: gzip off`).toMatch(/gzip\s+off/);
  expect(body, `${label}: proxy_cache off`).toMatch(/proxy_cache\s+off/);
  expect(body, `${label}: HTTP/1.1`).toMatch(/proxy_http_version\s+1\.1/);
  const timeout = body.match(/proxy_read_timeout\s+(\d+)s/);
  expect(timeout, `${label}: proxy_read_timeout`).toBeTruthy();
  expect(Number(timeout![1]), `${label}: read timeout >= 300s`).toBeGreaterThanOrEqual(300);

  const report = conf.match(/location\s+\/r\/\s*\{([\s\S]*?)\}/);
  expect(report, `${label}: missing location /r/`).toBeTruthy();
  expect(report![1], `${label}: /r/ proxy_pass`).toMatch(/proxy_pass\s+http:\/\/(127\.0\.0\.1|localhost):3000/);
  expect(report![1], `${label}: /r/ must not try_files`).not.toMatch(/try_files/);

  expect(conf, `${label}: location = /health`).toMatch(/location\s+=\s+\/health\s*\{/);
}

describe("T1 pack payload includes frontend dist", () => {
  it("packs hashed JS/CSS and logo.png via ./ops.sh pack (not a reimplemented tar)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "rhg-pack-"));
    const archive = join(mkdtempSync(join(tmpdir(), "rhg-pack-out-")), "payload.tar.gz");
    try {
      mkdirSync(join(fixture, "dist", "assets"), { recursive: true });
      mkdirSync(join(fixture, "screenshots"), { recursive: true });
      writeFileSync(
        join(fixture, "dist", "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="/assets/${hashedCss}"></head><body><script type="module" src="/assets/${hashedJs}"></script></body></html>\n`,
      );
      writeFileSync(join(fixture, "dist", "assets", hashedJs), "/* fixture js */\n");
      writeFileSync(join(fixture, "dist", "assets", hashedCss), "/* fixture css */\n");
      writeFileSync(join(fixture, "dist", "logo.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      writeFileSync(join(fixture, "screenshots", "ignore.png"), "should-not-pack");

      const out = sh([opsSh, "pack", archive], { PACK_SRC: fixture });
      expect(out).toMatch(/Archive:/);

      const names = tarList(archive);
      const indexHtml = readFileSync(join(fixture, "dist", "index.html"), "utf8");
      const cited = [...indexHtml.matchAll(/\/assets\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map((m) => m[1]);
      expect(cited.sort()).toEqual([hashedCss, hashedJs].sort());

      const missing: string[] = [];
      for (const file of cited) {
        if (!names.some((n) => n === `dist/assets/${file}` || n.endsWith(`/dist/assets/${file}`))) {
          missing.push(`dist/assets/${file}`);
        }
      }
      if (!names.some((n) => n === "dist/logo.png" || n.endsWith("/dist/logo.png"))) {
        missing.push("dist/logo.png");
      }
      if (!names.some((n) => n === "dist/index.html" || n.endsWith("/dist/index.html"))) {
        missing.push("dist/index.html");
      }
      expect(missing, `hashed assets missing from archive: ${missing.join(", ")}`).toEqual([]);
      expect(names.some((n) => n.includes("screenshots/ignore.png"))).toBe(false);

      const opsText = readFileSync(opsSh, "utf8");
      const packFn = opsText.slice(opsText.indexOf("pack_mvp_archive()"), opsText.indexOf("print_remote_deploy()"));
      expect(packFn).toMatch(/tar czf/);
      expect(packFn).not.toMatch(/--exclude=['"]dist['"]/);
      expect(packFn).not.toMatch(/--exclude=dist(?:\s|$)/);
      expect(packFn).not.toMatch(/--exclude=['"]\*\.png['"]/);
      expect(opsText).toMatch(/pack_mvp_archive "\$archive"/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("T2 nginx writers emit SSE and /r/", () => {
  it("dumps the conf the Aliyun writers would write (not mvp/nginx.conf)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rhg-nginx-"));
    try {
      const domainOut = join(dir, "domain.conf");
      const ipOut = join(dir, "ip.conf");
      sh([join(repoRoot, "scripts/configure-aliyun-static-nginx.sh")], {
        NGINX_CONF_OUT: domainOut,
      });
      sh([join(repoRoot, "scripts/configure-aliyun-ip-api-nginx.sh")], {
        NGINX_CONF_OUT: ipOut,
        ALIYUN_HOST: "203.0.113.9",
      });

      const domain = readFileSync(domainOut, "utf8");
      const ip = readFileSync(ipOut, "utf8");
      assertSseAndReportLocations(domain, "domain");
      assertSseAndReportLocations(ip, "ip");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("T3 single live deploy entry", () => {
  it("docs name only ./ops.sh deploy --yes; leftover scripts fail pointing at ops.sh", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    const checklist = readFileSync(join(repoRoot, "docs/PRODUCT_RELEASE_GATE.md"), "utf8");
    expect(readme).toMatch(/\.\/ops\.sh deploy --yes/);
    expect(checklist).toMatch(/\.\/ops\.sh deploy --yes/);
    expect(readme).not.toMatch(/git reset --hard origin\/main/);
    expect(checklist).not.toMatch(/git reset --hard origin\/main/);

    for (const rel of ["deploy-to-aliyun.sh", "mvp/deploy.sh"]) {
      const text = readFileSync(join(repoRoot, rel), "utf8");
      expect(text, rel).not.toMatch(/git reset --hard origin\/main/);
      expect(text, rel).not.toMatch(/--exclude=['"]dist['"]/);
      expect(text, rel).not.toMatch(/--exclude=['"]\*\.png['"]/);
      let err = "";
      try {
        sh([join(repoRoot, rel)]);
      } catch (e) {
        err = e instanceof Error ? `${e.message}\n${(e as { stdout?: string; stderr?: string }).stderr ?? ""}\n${(e as { stdout?: string }).stdout ?? ""}` : String(e);
      }
      expect(err, `${rel} must fail`).toMatch(/ops\.sh deploy --yes/);
    }
  });
});

describe("T4 named-volume migrate before compose up", () => {
  it("print-remote-deploy copies .data/.agent-memory before down and never uses -v", () => {
    const script = sh([opsSh, "print-remote-deploy", "/opt/red-herring/mvp"]);
    expect(script).toMatch(/docker cp red-herring-api:\/app\/server\/\.data\/\./);
    expect(script).toMatch(/docker cp red-herring-api:\/app\/server\/\.agent-memory\/\./);

    const copyDataAt = script.indexOf("docker cp red-herring-api:/app/server/.data/.");
    const downAt = script.search(/docker compose down(?!\s+-v)/);
    const upAt = script.indexOf("docker compose up -d --build");
    expect(copyDataAt).toBeGreaterThanOrEqual(0);
    expect(downAt).toBeGreaterThan(copyDataAt);
    expect(upAt).toBeGreaterThan(downAt);

    expect(script).not.toMatch(/docker compose down\s+-v/);
    expect(script).not.toMatch(/docker compose down\s+--volumes/);
    expect(script).not.toMatch(/compose down --volumes/);
    expect(script).toMatch(/copy_if_dest_empty \/app\/server\/\.data/);
    expect(script).toMatch(/copy_if_dest_empty \/app\/server\/\.agent-memory/);
    expect(script).toMatch(/\/opt\/red-herring\/dist/);

    const opsText = readFileSync(opsSh, "utf8");
    expect(opsText).toMatch(/print_remote_deploy "\$remote_dir" \| ssh/);
    expect(script).toMatch(/dist\.prev/);
    expect(script).toMatch(/red-herring-red-herring-api:prev/);
  });
});

describe("T7 rollback and empty env", () => {
  it("print-rollback restores dist.prev and :prev and never uses compose down -v", () => {
    const script = sh([opsSh, "print-rollback"]);
    expect(script).toMatch(/dist\.prev/);
    expect(script).toMatch(/red-herring-red-herring-api:prev/);
    expect(script).toMatch(/docker compose down\n/);
    expect(script).toMatch(/docker compose up -d\n/);
    expect(script).not.toMatch(/docker compose down\s+-v/);
    expect(script).not.toMatch(/down --volumes/);
    expect(script).not.toMatch(/--build/);
    const opsText = readFileSync(opsSh, "utf8");
    expect(opsText).toMatch(/print_remote_rollback \| ssh/);
  });

  it("empty .env.local is not treated as uploadable", () => {
    const opsText = readFileSync(opsSh, "utf8");
    expect(opsText).toMatch(/Local \.env\.local is empty; not overwriting remote env/);
    const match = opsText.match(/env_file_is_uploadable\(\) \{\n[\s\S]*?\n\}/);
    expect(match, "env_file_is_uploadable function").toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "rhg-env-"));
    try {
      const empty = join(dir, "empty");
      const comments = join(dir, "comments");
      const real = join(dir, "real");
      writeFileSync(empty, "");
      writeFileSync(comments, "\n\n# comment only\n");
      writeFileSync(real, "FOO=bar\n");
      const run = (file: string) => {
        try {
          execFileSync("bash", ["-c", `${match![0]}\nenv_file_is_uploadable "$1"`, "fn", file], {
            encoding: "utf8",
          });
          return 0;
        } catch (e) {
          return (e as { status?: number }).status ?? 1;
        }
      };
      expect(run(empty), "empty file").not.toBe(0);
      expect(run(comments), "comments only").not.toBe(0);
      expect(run(real), "real env").toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
