// The Projects page's pure parts: a row's state and the line after a load.
import { expect, test } from "bun:test"
import { loadNote, projectState } from "./projects.js"

test("projectState: missing folder first, then set up (.agents/project.md), else not yet", () => {
  expect(projectState({ missing: true, setup: true })).toEqual({ label: "folder missing", tone: "error" })
  expect(projectState({ setup: true })).toEqual({ label: "set up", tone: "ok" })
  expect(projectState({})).toEqual({ label: "not set up yet", tone: "wait" })
})

test("loadNote: loaded or reopened, and whether the lead got the setup run", () => {
  const project = { name: "shop", workspace: "projects/shop" }
  expect(loadNote({ project, created: true, setup: "sent" })).toBe("Loaded shop → projects/shop/. The lead is setting it up now — follow it on Home.")
  expect(loadNote({ project, created: false, setup: "skipped" })).toBe("Already loaded: shop → projects/shop/.")
  expect(loadNote({ project, created: true, setup: "No agent" })).toBe("Loaded shop → projects/shop/. The setup was not sent: No agent")
})
