import { test, expect } from "bun:test";
import { HREF, API_PATHS, engineHref, pageHref, routeOf, viewOf, isCurrent, homeOf, needsUnlock } from "./routes.js";
const u = (s) => new URL(s, "http://x");
test("each destination has its own URL that parses back", () => {
  expect(routeOf(u("/"))).toEqual({ kind: "dashboard" });
  expect(routeOf(u("/canvas"))).toEqual({ kind: "canvas" });
  expect(routeOf(u("/models/"))).toEqual({ kind: "models" });
  expect(routeOf(u(HREF.theme))).toEqual({ kind: "theme" });
  expect(routeOf(u(pageHref("canvas")))).toEqual({ kind: "page", view: "canvas" });
  expect(routeOf(u(pageHref("dashboard")))).toEqual({ kind: "page", view: "dashboard" });
  expect(routeOf(u("/focus?id=a"))).toEqual({ kind: "focus" });
  expect(routeOf(u("/nope")).kind).toBe("unknown");
  expect(routeOf(u("/e/")).kind).toBe("unknown");
});
test("engine ids keep their slashes and survive odd characters", () => {
  expect(engineHref("askk/loop")).toBe("/e/askk/loop");
  for (const id of ["askk", "askk/loop", "a b/c?d#e", "ü/%"]) expect(routeOf(u(engineHref(id)))).toEqual({ kind: "engine", id });
  expect(routeOf(u("/e/%E0%A4%A")).kind).toBe("unknown");
});
test("only the dashboard route is the dashboard", () => {
  for (const p of ["/models", "/tokens", "/page", "/e/askk"]) expect(routeOf(u(p)).kind).not.toBe("dashboard");
});
test("view, current item, home and lock", () => {
  expect(viewOf(routeOf(u("/canvas")))).toBe("canvas");
  expect(viewOf(routeOf(u("/page?view=canvas")))).toBe("canvas");
  expect(viewOf(routeOf(u("/models")))).toBe("dashboard");
  expect(isCurrent(routeOf(u("/e/a/b")), { kind: "engine", id: "a/b" })).toBe(true);
  expect(isCurrent(routeOf(u("/e/a")), { kind: "engine", id: "a/b" })).toBe(false);
  expect(isCurrent(routeOf(u("/models")), { kind: "models" })).toBe(true);
  expect(homeOf(routeOf(u("/page?view=canvas")))).toBe("/canvas");
  expect(homeOf(routeOf(u("/models")))).toBe("/");
  expect(needsUnlock(routeOf(u("/tokens")))).toBe(true);
  expect(needsUnlock(routeOf(u("/models")))).toBe(false);
});
test("no UI route shadows an API path (reload must reach index.html)", () => {
  const ui = [...Object.values(HREF), pageHref("dashboard").split("?")[0], "/focus", "/e"];
  for (const a of API_PATHS) for (const r of ui) expect(r === a || r.startsWith(a + "/")).toBe(false);
});
