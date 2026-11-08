import { test, expect } from "bun:test";
import { avatarState, initials, iconOf, isAsset } from "./avatar.js";
test("engine status → avatar: running pulses violet, asking 💬, failed ⚠️, stopped/offline dim, idle online dot", () => {
  expect(avatarState({ phase: "idle", running: 1 })).toMatchObject({ ring: "pulse", tone: "accent", badge: null, dim: false, word: "running" });
  expect(avatarState({ phase: "running" }).ring).toBe("pulse");
  expect(avatarState({ phase: "idle", asks: 2 })).toMatchObject({ badge: "💬", word: "asking" });
  expect(avatarState({ phase: "waiting" })).toMatchObject({ badge: "💬", ring: "pulse" });
  expect(avatarState({ phase: "idle", failed: 1 })).toMatchObject({ badge: "⚠️", tone: "error" });
  expect(avatarState({ phase: "failed" }).badge).toBe("⚠️");
  expect(avatarState({ phase: "stopped" })).toMatchObject({ dim: true, ring: "none", badge: null, word: "stopped" });
  expect(avatarState({ phase: "running", online: false })).toMatchObject({ dim: true, ring: "none", word: "offline" });
  expect(avatarState({ phase: "idle" })).toMatchObject({ dot: true, tone: "ok", word: "idle" });
});
test("icons: the twin's, else its icon view's Avatar; initials fallback; assets", () => {
  expect(iconOf({ icon: "🧭" })).toBe("🧭");
  expect(iconOf({ views: { icon: { c: "Card", children: [{ c: "Avatar", props: { icon: "🧠" } }] } } })).toBe("🧠");
  expect(iconOf({})).toBe(null);
  expect(initials("Research desk")).toBe("RD");
  expect(initials("home")).toBe("HO");
  expect(isAsset("/ui/assets/a.png")).toBe(true);
});
