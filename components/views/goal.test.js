import { describe, expect, test } from "bun:test"
import * as React from "react"
import { renderToString } from "react-dom/server"

import { withDictation } from "@/components/chat/dictation-text"
import { micLook } from "@/components/chat/mic-look"
import { GoalView, RequestForm, RequestRow } from "./goal"

// 2026-10-27 request-to-loop: the goal card's feature request field.
describe("RequestForm", () => {
  test("draws the feature request field and its button, off while empty", () => {
    const html = renderToString(React.createElement(RequestForm, { id: "goal" })).replaceAll("<!-- -->", "")
    expect(html).toContain('aria-label="Feature request"')
    expect(html).toContain("Request")
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
  })
})
// 2026-10-27 request-voice: a spoken request — the composer's mic beside Request, dictation into the field.
describe("RequestRow (request-voice)", () => {
  const speech = { support: { supported: true }, listening: false }
  const props = { text: "", busy: false, speech, onType() {}, onMic() {}, onOffTap() {}, onSubmit() {} }
  const draw = (p) => renderToString(React.createElement(RequestRow, { ...props, ...p })).replaceAll("<!-- -->", "")

  test("the composer's mic, with micLook's label, sits beside Request", () => {
    const html = draw()
    const label = micLook({ support: speech.support, listening: false }).label
    expect(html).toContain(`aria-label="${label}"`)
    expect(html.indexOf(`aria-label="${label}"`)).toBeLessThan(html.lastIndexOf("Request"))
  })

  test("dictation fills the field after what was typed", () => {
    const text = withDictation("add a", "mic to the goal card")
    expect(text).toBe("add a mic to the goal card")
    expect(draw({ text })).toContain('value="add a mic to the goal card"')
  })

  test("an off mic's tap reason shows under the field", () => {
    expect(draw({ micNote: "Dictation is not available here" })).toContain("Dictation is not available here")
  })
})
// 2026-10-27 request-reach: on a phone the request comes first, right under the goal, before the Live view, Feedback
// and Milestones, so it is reachable at 375px without scrolling past the preview.
describe("GoalView (request-reach)", () => {
  const state = {
    status: "active",
    cadence_minutes: 60,
    goal: { text: "ASKK gains an evolved interaction mechanism", measure: "features shipped" },
    milestones: [{ id: "editor-wrap", text: "the /live Editor soft-wraps", status: "open" }],
    entries: [],
  }
  test("the expanded card draws the Feature request field once, before Feedback and Milestones", () => {
    const html = renderToString(React.createElement(GoalView, { id: "goal", state, expanded: true })).replaceAll("<!-- -->", "")
    const at = html.indexOf('aria-label="Feature request"')
    expect(at).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="Feature request"', at + 1)).toBe(-1)
    expect(at).toBeLessThan(html.indexOf('aria-label="Feedback on the goal"'))
    expect(at).toBeLessThan(html.indexOf('aria-label="Milestones"'))
  })
})
// 2026-10-27 request-mark: an owner's request reads "requested by owner" and "check: to plan"; a planned item neither.
describe("Plan (request-mark)", () => {
  const state = {
    status: "active",
    cadence_minutes: 60,
    goal: { text: "ASKK gains an evolved interaction mechanism", measure: "features shipped" },
    milestones: [
      { id: "editor-wrap", text: "the /live Editor soft-wraps", check: null, status: "open" },
      { id: "add-a-mic", text: "add a mic", check: null, requested: true, status: "open" },
    ],
    entries: [],
  }
  test("the requested line is marked and its check is to plan; the planned line shows neither", () => {
    const html = renderToString(React.createElement(GoalView, { id: "goal", state, expanded: true })).replaceAll("<!-- -->", "")
    const items = html.split("<li").filter((li) => li.includes("add-a-mic") || li.includes("editor-wrap"))
    const requested = items.find((li) => li.includes("add-a-mic"))
    const planned = items.find((li) => li.includes("editor-wrap"))
    expect(requested).toContain("requested by owner")
    expect(requested).toContain("check: to plan")
    expect(planned).not.toContain("requested by owner")
    expect(planned).not.toContain("check:")
  })
})
