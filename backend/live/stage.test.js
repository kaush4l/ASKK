import { describe, expect, test } from "bun:test"
import { askThread, bridgeMessage, contextLine, frameCheck, frameSrc, sceneMessage, shownScene, stageOf, stepScene } from "./stage.js"
import { CALL_KINDS, callLook } from "./visual.js"

const state = {
  page: { url: "http://127.0.0.1:8077/", title: "story" },
  scenes: [
    { id: "training", title: "Loss falls", view: "training", says: "…", params: null },
    { id: "attention", title: "Heads", view: "attention", says: "…", params: { layer: 2, head: 1 } },
    { id: "latent", title: "Thinking", view: "latent", says: "…", params: null },
  ],
  current: "attention",
  asks: [
    { id: "q1", text: "why?", answer: { text: "because", scene: "attention" } },
    { id: "q2", text: "loss?", answer: null },
  ],
  revision: 5,
}

describe("stage twin", () => {
  test("stageOf: the stage artifact (id stage first), or null", () => {
    const artifacts = { plan: { id: "plan", view: "checklist" }, "demo.stage": { id: "demo.stage", view: "stage" }, stage: { id: "stage", view: "stage" } }
    expect(stageOf(artifacts).id).toBe("stage")
    expect(stageOf(artifacts, "demo.stage").id).toBe("demo.stage")
    expect(stageOf({ plan: artifacts.plan })).toBeNull()
    expect(stageOf(null)).toBeNull()
  })

  test("frameCheck: loopback pages with a port, never this tab's origin; another device is told where it runs", () => {
    expect(frameCheck("http://127.0.0.1:8077/", "http://localhost:1111/stage")).toEqual({ ok: true })
    expect(frameCheck("http://localhost:1111/", "http://localhost:1111/stage")).toMatchObject({ ok: false, reason: "the page is on the desk server's own port" })
    expect(frameCheck("http://127.0.0.1:1111/x", "http://localhost:1111/stage")).toMatchObject({ ok: false })
    expect(frameCheck("https://example.org:8077/", "http://localhost:1111/")).toMatchObject({ ok: false, reason: "the stage shows only pages on the desk's computer" })
    expect(frameCheck("http://127.0.0.1:8077/", "http://192.168.1.4:1111/stage")).toMatchObject({ ok: false, remote: true })
    expect(frameCheck("nope", "http://localhost:1111/")).toMatchObject({ ok: false })
  })

  test("frameSrc and sceneMessage: the page with #view; the scene the page gets", () => {
    expect(frameSrc("http://127.0.0.1:8077/#old", state.scenes[1])).toBe("http://127.0.0.1:8077/#attention")
    expect(frameSrc("http://127.0.0.1:8077/")).toBe("http://127.0.0.1:8077/")
    expect(frameSrc(null)).toBeNull()
    expect(sceneMessage(state.scenes[1])).toEqual({ askk: "scene", scene: { id: "attention", view: "attention", title: "Heads", params: { layer: 2, head: 1 } } })
  })

  test("bridgeMessage: only the frame's window and origin; at and ask, sanitized", () => {
    const frame = {}
    const origin = "http://127.0.0.1:8077"
    const from = (data, extra = {}) => bridgeMessage({ source: frame, origin, data, ...extra }, { frame, origin })
    expect(from({ askk: "at", view: "attention", views: ["training", "attention", "bad view!"] })).toEqual({ type: "at", view: "attention", views: ["training", "attention"] })
    expect(from({ askk: "ask", context: { layer: 2, head: 1, step: 800 } })).toEqual({ type: "ask", context: { layer: 2, head: 1, step: 800 }, text: "" })
    expect(from({ askk: "ask", text: "  why this head?  " })).toEqual({ type: "ask", context: null, text: "why this head?" })
    expect(from({ askk: "ask", context: { big: "x".repeat(2000) } })).toBeNull()
    expect(from({ askk: "at", view: "<script>" })).toBeNull()
    expect(from({ askk: "run", text: "rm" })).toBeNull()
    expect(from("hello")).toBeNull()
    expect(from({ askk: "at", view: "training" }, { source: {} })).toBeNull()
    expect(from({ askk: "at", view: "training" }, { origin: "http://localhost:1111" })).toBeNull()
  })

  test("shownScene: following → the agent's current scene; paused → the owner's pick; stepScene; askThread; contextLine", () => {
    expect(shownScene(state, { following: true, picked: "training" }).id).toBe("attention")
    expect(shownScene(state, { following: false, picked: "training" }).id).toBe("training")
    expect(shownScene(state, { following: false, picked: null }).id).toBe("attention")
    expect(shownScene({ scenes: [] }, { following: true })).toBeNull()
    expect(stepScene(state, "attention", 1).id).toBe("latent")
    expect(stepScene(state, "training", -1)).toBeNull()
    expect(stepScene(state, "gone", 1)).toBeNull()
    expect(askThread(state).map((a) => [a.id, a.open])).toEqual([
      ["q1", false],
      ["q2", true],
    ])
    expect(contextLine({ layer: 2, head: 1, tokens: [3, 4] })).toBe("layer 2 · head 1 · tokens [3,4]")
    expect(contextLine(null)).toBe("")
  })

  test("a stage call draws as the stage wherever calls are drawn (stage.show is type dev, the others artifact)", () => {
    expect(callLook({ type: "dev", view: "stage", name: "stage.show" })).toEqual({ kind: "stage", tone: "fuchsia", icon: "presentation" })
    expect(callLook({ type: "artifact", view: "stage", name: "stage.scene" }).kind).toBe("stage")
    expect(CALL_KINDS).toContain("stage")
  })
})
