import { test, expect } from "bun:test";
import { portal } from "./portal.js";
test("portal moves the node to the target and removes it on destroy", () => {
  const kids = []; const target = { appendChild: (n) => kids.push(n) };
  let removed = false; const node = { remove: () => { removed = true; } };
  const a = portal(node, target); expect(kids).toEqual([node]); a.destroy(); expect(removed).toBe(true);
});
