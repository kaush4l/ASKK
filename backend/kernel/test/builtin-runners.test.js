import { expect, test } from "bun:test"
import { Runners } from "../index.js"

const at = (iso) => new Date(iso)

// a level watcher: value from a scripted series, fires when it crosses above `level`
function rig(series) {
  let now = at("2026-10-22T14:00:00Z")
  const fired = []
  const r = new Runners({
    id: "watchers",
    clock: () => now,
    prepare: async () => ({ px: series.shift() }),
    check: async (w, { px }) => {
      if (px == null) return null
      if (px === "boom") throw new Error("quote failed")
      const holds = px >= w.level
      const fire = w.held === false && holds
      w.held = holds
      return { value: px, against: w.level, holds, gap: holds ? 0 : w.level - px, fire, price: px }
    },
    onFire: async (w, res) => (fired.push(w.id), `${w.id} fired at ${res.value}`),
    describe: (w) => `price above ${w.level}`,
  })
  return { r, fired, step: (iso) => (now = at(iso)) }
}

test("a runner is checked on its own clock, counts checks, tracks gap/pace/eta and fires once", async () => {
  const { r, fired, step } = rig([700, 704, 708, 712])
  r.add({ id: "spy", level: 710, then: "enter", ends_at: "2026-10-22T20:00:00Z" }, "local")
  expect(await r.tick()).toEqual([])
  expect(r.get("spy")).toMatchObject({ status: "running", checks: 1, set_by: "local", last: { value: 700, prox: { gap: 10, pace: null } } })
  expect(await r.tick()).toEqual([]) // not due again within the minute
  step("2026-10-22T14:01:00Z")
  await r.tick()
  expect(r.get("spy").last.prox).toEqual({ gap: 6, pace: 4, eta: 2 })
  expect(r.render()).toContain("spy running · price above 710 · now 704 vs 710 · gap 6 ≈2 checks · check #2 10:01, next 10:02 → enter")
  step("2026-10-22T14:02:00Z")
  await r.tick()
  step("2026-10-22T14:03:00Z")
  expect(await r.tick()).toEqual(["spy fired at 712"])
  expect(r.get("spy")).toMatchObject({ status: "fired", checks: 4, fires: [{ kind: "fire", price: 712 }] })
  expect(fired).toEqual(["spy"])
  expect(r.brief()).toBe("0 running · 0 paused · 1 fired")
})

test("pause skips checks, resume and check-now run it; errors halt after 3; expiry ends it", async () => {
  const { r, step } = rig([700, "boom", "boom", "boom", 701])
  r.add({ id: "a", level: 710, ends_at: "2026-10-22T15:00:00Z" })
  expect(r.pause("a", "news pending")).toBe("paused a: news pending")
  await r.tick()
  expect(r.get("a").checks).toBe(0)
  await expect(r.checkNow("a")).rejects.toThrow("resume it first")
  expect(r.resume("a")).toBe("resumed a")
  expect(await r.checkNow("a")).toContain("a running · price above 710 · now 700")
  for (const m of ["01", "02", "03"]) {
    step(`2026-10-22T14:${m}:00Z`)
    await r.tick()
  }
  expect(r.get("a")).toMatchObject({ status: "error", errors: 3, error: "quote failed" })
  expect(r.render()).toContain("a error (quote failed)")
  r.resume("a")
  step("2026-10-22T14:04:00Z")
  await r.tick()
  expect(r.get("a")).toMatchObject({ status: "running", errors: 0, error: null, checks: 2 })
  step("2026-10-22T15:00:00Z")
  expect(await r.tick()).toEqual(["a expired"])
  expect(() => r.resume("a")).toThrow("ended at 11:00 ET")
})

test("the owner's calls and the agent's commands; restore keeps the run state", async () => {
  const { r } = rig([700])
  r.add({ id: "b", level: 710 })
  expect(r.commands().map((t) => t.name)).toEqual(["watchers.pause", "watchers.resume", "watchers.check"])
  expect(await r.commands()[0].run({ id: "b", reason: "x" })).toBe("paused b: x")
  expect(await r.ownerCall("resume", [{ id: "watchers", runner: "b" }])).toEqual({ said: "resumed b" })
  expect((await r.ownerCall("now", [{ id: "watchers", runner: "b" }])).said).toContain("now 700")
  expect(() => r.ownerCall("explode", [{}])).toThrow("the owner can")
  const copy = new Runners({ id: "watchers" })
  copy.restore(r.snapshot())
  expect(copy.get("b")).toMatchObject({ checks: 1, status: "running" })
  expect(r.ownerCall("remove", [{ runner: "b" }])).toEqual({ said: "removed b" })
  expect(r.live().view).toBe("runners")
})
