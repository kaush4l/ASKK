import { test, expect } from "bun:test";
// The old viewpoints (row, card, full) are gone everywhere a view is named; icon stays as the tiniest size.
const ROOT = new URL("../../../", import.meta.url).pathname;
const files = [
  ...new Bun.Glob("src/**/*.{js,svelte,json}").scanSync({ cwd: ROOT }),
  ...new Bun.Glob("core/src/**/*.rs").scanSync({ cwd: ROOT }),
  ...new Bun.Glob("server/src/**/*.rs").scanSync({ cwd: ROOT }),
  "docs/contract.md", "docs/design-rules.md", "README.md",
].filter((f) => !f.endsWith("views.test.js"));
const OLD = [
  /views\??\.(row|card|full)\b/, /\["views"\]\["(row|card|full)"\]/, /views\?*\.?\[["'](row|card|full)["']\]/,
  /"at"\s*[,:]\s*"(row|card|full)"/, /\bat:\s*"?(row|card|full)\b/, /\bat=["'{](row|card|full)\b/, /slot\([^)]*"(row|card|full)"\)/,
  /\bfn (row|card|full)\(&self/, /\bviewpointForZoom\b/, /Views \{ icon: [^}]*\brow:/,
];
test("no view is named row, card or full", async () => {
  const hits = [];
  for (const f of files) {
    const text = await Bun.file(ROOT + f).text();
    text.split("\n").forEach((line, i) => { for (const re of OLD) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  expect(hits).toEqual([]);
});
