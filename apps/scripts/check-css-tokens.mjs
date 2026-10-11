// The :root block of golden-path.css is the only place goldenPath CSS may write a colour. A literal colour elsewhere
// drifts from the palette unnoticed, and a var(--gp-*) that is never defined silently resolves to nothing (the archived
// source pill shipped four of those). This check fails on both so they cannot come back.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(appsDir, "src");
const cssDir = join(srcDir, "goldenPath");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );

// Blank out comments and string contents but keep every newline, so offsets still map to the right line.
const blank = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + " ".repeat(m.length - 2) + m[0]);

function declarations(text) {
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      stack.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (ch === ";" || ch === "}") {
      const seg = text.slice(start, i);
      if (seg.trim() && stack.length) {
        const offset = start + seg.length - seg.trimStart().length;
        out.push({ text: seg.trim(), line: text.slice(0, offset).split("\n").length, inRoot: stack.includes(":root") });
      }
      if (ch === "}") stack.pop();
      start = i + 1;
    }
  }
  return out;
}

const cssFiles = readdirSync(cssDir)
  .filter((name) => name.endsWith(".css"))
  .map((name) => join(cssDir, name));
const parsed = cssFiles.map((file) => ({ file, decls: declarations(blank(readFileSync(file, "utf8"))) }));

const defined = new Set();
for (const { decls } of parsed) {
  for (const { text } of decls) {
    const m = /^(--gp-[\w-]+)\s*:/.exec(text);
    if (m) defined.add(m[1]);
  }
}
// Custom properties a component sets inline, e.g. style={{ "--gp-enter-delay": … }}.
for (const file of walk(srcDir).filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
  for (const m of readFileSync(file, "utf8").matchAll(/["'`](--gp-[\w-]+)["'`]/g)) defined.add(m[1]);
}

const HEX = /#[0-9a-f]{3,8}\b/i;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const problems = [];
for (const { file, decls } of parsed) {
  const where = (line) => `${relative(appsDir, file)}:${line}`;
  for (const { text, line, inRoot } of decls) {
    if (!inRoot && HEX.test(text)) problems.push(`${where(line)}: hex colour outside :root: ${text}`);
    if (!inRoot && COLOR_FN.test(text)) problems.push(`${where(line)}: colour function outside :root: ${text}`);
    for (const m of text.matchAll(/var\(\s*(--gp-[\w-]+)/g)) {
      if (!defined.has(m[1])) problems.push(`${where(line)}: ${m[1]} is used but never defined`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncheck:css found ${problems.length} problem(s). Add a token to the :root block in golden-path.css and use it.`);
  process.exit(1);
}
console.log(`check:css ok (${cssFiles.length} files, ${defined.size} --gp-* tokens)`);
