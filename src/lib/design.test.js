// The design rules by structure (docs/design-rules.md §10): one token file is the source of every value, and no
// primitive, component or route carries a raw one. These tests fail on any drift or raw value.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import TOKENS from "../../design/tokens.json";
import { DEFAULT_TOKENS, tokenBlock, BLOCK_START, BLOCK_END, themeCss } from "./logic/theme.js";
import { DEFAULT_UI } from "./logic/page.js";

const root = new URL("../..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const files = (dir, ext) => readdirSync(join(root, dir)).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(root, p)).isDirectory() ? files(p, ext) : n.endsWith(ext) ? [p] : [];
});

test("one token file: the frontend defaults and the app.css token block are the file", () => {
  expect(DEFAULT_TOKENS).toEqual(TOKENS);
  const css = read("src/app.css");
  const block = css.slice(css.indexOf(BLOCK_START), css.indexOf(BLOCK_END) + BLOCK_END.length);
  expect(block).toBe(tokenBlock());
  for (const g of ["space", "text", "radius", "motion", "ease", "font", "glass", "background", "light", "dark"]) expect(TOKENS[g]).toBeTruthy();
  expect(Object.keys(TOKENS.space)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  expect(Object.keys(TOKENS.text)).toEqual(["xs", "sm", "md", "lg", "xl"]);
  expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  expect(themeCss(TOKENS)).toContain("--motion-calm:260ms;");
});

const BREAKS = new Set(Object.values(TOKENS.breakpoint));
/** Raw values in one file's text (comments stripped): px/rem/em lengths, hex/rgb/hsl colours, font names, durations. */
export function rawValues(text, { css = false } = {}) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const at = (what, m) => out.push(`${i + 1}: ${what} "${m}"`);
    for (const m of line.matchAll(/(?<![\w.-])\d*\.?\d+(px|rem|em)\b/g)) {
      if (/@media/.test(line) && BREAKS.has(m[0])) continue; // a breakpoint token's value (media queries cannot read vars)
      at("length", m[0]);
    }
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) at("hex colour", m[0]);
    for (const m of line.matchAll(/\b(rgba?|hsla?)\(/g)) at("colour function", m[0]);
    for (const m of line.matchAll(/font-family\s*:\s*(?!var\(|inherit)[^;}"]+/g)) at("font name", m[0]);
    for (const m of line.matchAll(/(?<![\w.-])\d*\.?\d+m?s\b(?!-)/g)) at("duration", m[0]);
    for (const m of line.matchAll(/\b(duration|delay)\s*:\s*\d/g)) at("duration", m[0]);
    for (const m of line.matchAll(/\bms\(\s*\d/g)) at("duration", m[0]);
    for (const m of line.matchAll(/<svg[^>]*\s(width|height)="\d/g)) at("svg size", m[0]);
  });
  return out;
}

test("the lint itself catches each kind of raw value", () => {
  for (const bad of ["a{padding:12px}", "a{font-size:.8rem}", "a{color:#fff}", "a{color:rgb(0 0 0)}", "a{font-family:Georgia,serif}", "a{transition:color .3s}", "x.animate(k, { duration: 260 })", "ms(240)", `<svg width="18">`])
    expect(rawValues(bad).length).toBeGreaterThan(0);
  for (const ok of ["a{padding:var(--space-3)}", "{#each xs as x}", "a{width:calc(100% - var(--space-2))}", "a{color:var(--fg)}", "ms(\"calm\")", "@media (max-width:768px){}"])
    expect(rawValues(ok)).toEqual([]);
});

test("no raw values in primitives, components, routes, or app.css outside its token block", () => {
  const list = [...files("src/lib/primitives", ".svelte"), ...files("src/lib/components", ".svelte"), ...files("src/routes", ".svelte")];
  const found = {};
  for (const f of list) { const r = rawValues(read(f)); if (r.length) found[f] = r; }
  const css = read("src/app.css");
  const outside = css.slice(0, css.indexOf(BLOCK_START)) + css.slice(css.indexOf(BLOCK_END) + BLOCK_END.length);
  const r = rawValues(outside.replace(/@font-face\{[^}]*\}/, ""), { css: true });
  if (r.length) found["src/app.css"] = r;
  expect(found).toEqual({});
});

test("the page trees the UI falls back to name scale steps only", () => {
  const walk = (n, out = []) => { out.push(n); (n.children ?? []).forEach((k) => walk(k, out)); return out; };
  for (const v of Object.keys(DEFAULT_UI)) for (const n of walk(DEFAULT_UI[v])) {
    const s = JSON.stringify(n.props ?? {});
    expect(rawValues(s)).toEqual([]);
    expect(s).not.toMatch(/\d(%|vmax)/);
  }
});
