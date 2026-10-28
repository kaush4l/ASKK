// The market bridge's read tools as kernel tools: same names, checks and broker calls as the MCP bridge, through the
// desk host's mcp/call; text inputs turned back into the bridge's types; no order tool.

import { describe, expect, test } from "bun:test"
import { argsOf, marketTools } from "./market-tools.js"
import { BRIDGE_NAMES, BRIDGE_TOOLS } from "./market-bridge.js"

const now = new Date("2026-10-25T14:00:00Z")
const fakeHost = (answers = {}) => {
  const calls = []
  return { calls, post: async (path, body) => (calls.push({ path, body }), answers[body.tool] ?? { text: `{"ok":"${body.tool}"}` }) }
}
const byName = () => Object.fromEntries(marketTools({ clock: () => now }).map((t) => [t.name, t]))

describe("market kernel tools", () => {
  test("one per bridge read tool, read-only, data type, inputs from the bridge schema", () => {
    const tools = byName()
    expect(Object.keys(tools)).toEqual(BRIDGE_NAMES.map((n) => `market.${n}`))
    expect(Object.keys(tools).some((n) => /order|portfolio|position/.test(n))).toBe(false)
    expect(tools["market.bars"].spec()).toMatchObject({ type: "data", input: { symbol: "string", interval: "5minute | 10minute | hour | day | week", "days?": "number" } })
    expect(tools["market.quotes"].spec().input).toEqual({ symbols: "a list (comma-separated or [..]), ≤ 10" })
  })

  test("text inputs → the bridge's types", () => {
    const q = BRIDGE_TOOLS.find((t) => t.name === "quotes").inputSchema
    expect(argsOf(q, { symbols: "spy, QQQ" })).toEqual({ symbols: ["spy", "QQQ"] })
    expect(argsOf(q, { symbols: '["SPY","IWM"]' })).toEqual({ symbols: ["SPY", "IWM"] })
    const b = BRIDGE_TOOLS.find((t) => t.name === "bars").inputSchema
    expect(argsOf(b, { symbol: "SPY", interval: "day", days: "5" })).toEqual({ symbol: "SPY", interval: "day", days: 5 })
  })

  test("calls the broker through the host as the bridge would; refusals and broker errors throw", async () => {
    const host = fakeHost({ get_equity_quotes: { text: '{"SPY":761.2}' } })
    const tools = byName()
    expect(await tools["market.quotes"].run({ symbols: "spy,qqq" }, { host })).toBe('{"SPY":761.2}')
    expect(host.calls[0]).toEqual({ path: "mcp/call", body: { server: "robinhood", tool: "get_equity_quotes", arguments: { symbols: ["SPY", "QQQ"] } } })
    await tools["market.bars"].run({ symbol: "SPY", interval: "day", days: 3 }, { host })
    expect(host.calls[1].body.arguments).toMatchObject({ symbols: ["SPY"], interval: "day", bounds: "regular", end_time: now.toISOString() })
    // index: two broker calls, the id from the first
    const ix = fakeHost({ get_indexes: { text: '{"data":{"indexes":[{"id":"vix-1"}]}}' }, get_index_quotes: { text: '{"VIX":17.1}' } })
    expect(await tools["market.index_quote"].run({ symbol: "VIX" }, { host: ix })).toBe('{"VIX":17.1}')
    expect(ix.calls.map((c) => c.body.tool)).toEqual(["get_indexes", "get_index_quotes"])
    await expect(tools["market.bars"].run({ symbol: "SPY", interval: "1m" }, { host })).rejects.toThrow("interval: 5minute")
    await expect(tools["market.quotes"].run({ symbols: "SPY" }, { host: fakeHost({ get_equity_quotes: { isError: true, text: "refused by the guard" } }) })).rejects.toThrow("refused by the guard")
    await expect(tools["market.quotes"].run({ symbols: "SPY" }, {})).rejects.toThrow("no host")
  })
})
