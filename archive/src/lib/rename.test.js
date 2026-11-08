// The app is Askk: no old name left in code, docs or scripts — only README's note that the repo folder keeps the old name.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const OLD = new RegExp(["power", "house"].join(""), "i");
const root = new URL("../..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", "target", "build", ".svelte-kit", ".git", "data", "data-previous", "gen", "icons", "fonts"]);
const TEXT = /\.(js|svelte|rs|toml|json|md|sh|html|css|lock)$/;
function* walk(dir) {
  for (const n of readdirSync(join(root, dir))) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(join(root, p)).isDirectory()) yield* walk(p);
    else if (TEXT.test(n)) yield p;
  }
}
test("no old name left in code, docs or scripts", () => {
  const hits = [];
  for (const f of walk("")) {
    readFileSync(join(root, f), "utf8").split("\n").forEach((line, i) => {
      if (!OLD.test(line)) return;
      if (f === "README.md" && /repo(sitory)? folder/i.test(line)) return;
      hits.push(`${f}:${i + 1}`);
    });
  }
  expect(hits).toEqual([]);
  expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name).toBe("askk");
  expect(readFileSync(join(root, "src/app.html"), "utf8")).toContain("<title>Askk</title>");
});
