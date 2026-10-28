import { describe, expect, test } from "bun:test"
import { themeScriptProps } from "./theme-provider.jsx"

describe("script-tag-error: the theme script runs on the server and is data in the browser", () => {
  test("themeScriptProps(true): the server script keeps its runnable type", () => {
    expect(themeScriptProps(true)).toBeUndefined()
  })

  test("themeScriptProps(false): the browser copy is typed application/json", () => {
    expect(themeScriptProps(false).type).toBe("application/json")
  })
})
