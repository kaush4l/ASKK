import { describe, expect, test } from "bun:test"
import { BRIDGE_NAMES, bridgeCall, dataCall, dataTools, hostCaller, hostTools, plan, serve } from "./market-bridge.js"

const now = new Date("2026-10-22T14:00:00Z")

test("a fixed allowlist of read tools; anything else refused", async () => {
  expect(BRIDGE_NAMES).toEqual(["quotes", "bars", "option_chain", "option_instruments", "option_quotes", "index_quote", "indicators", "fundamentals", "analyst", "scan"])
  const at = new Date("2026-10-25T14:00:00Z")
  expect(plan("indicators", { symbols: ["spy", "QQQ"], type: "macd", interval: "day", fast_period: 8 }, at)).toEqual([{ tool: "get_equity_technical_indicators", arguments: { symbols: ["SPY", "QQQ"], type: "macd", interval: "day", bounds: "regular", start_time: "2026-06-27T14:00:00.000Z", end_time: "2026-10-25T14:00:00.000Z", output: "latest", fast_period: 8 } }])
  expect(plan("indicators", { symbols: ["SPY"], type: "pivot_points", interval: "day" }, at)[0].arguments.method).toBe("classic")
  expect(() => plan("indicators", { symbols: ["SPY"], type: "rsi", interval: "2minute" })).toThrow("interval: minute")
  expect(() => plan("indicators", { symbols: ["SPY"], type: "rsi", interval: "day", output: "all" })).toThrow("output: latest")
  expect(plan("scan", { filters: [{ filter_type: "FILTER_TYPE_RSI", predicate: "PREDICATE_LESS_THAN", values: ["30"] }] })[0]).toEqual({ tool: "preview_scan", arguments: { filters: [{ filter_type: "FILTER_TYPE_RSI", predicate: "PREDICATE_LESS_THAN", values: ["30"] }] } })
  expect(() => plan("scan", { filters: [] })).toThrow("filters: 1–12")
  expect(plan("analyst", { symbols: ["nvda"] })[0]).toEqual({ tool: "get_equity_analyst_ratings", arguments: { symbols: ["NVDA"] } })
  const r = await bridgeCall("place_equity_order", {}, { call: async () => "x" })
  expect(r).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("unknown tool place_equity_order") }] })
})

test("each tool's arguments are checked and mapped to the broker's read tools", () => {
  expect(plan("quotes", { symbols: ["spy", "SPY", "QQQ"] })).toEqual([{ tool: "get_equity_quotes", arguments: { symbols: ["SPY", "QQQ"] } }])
  expect(plan("bars", { symbol: "SPY", interval: "day", days: 30 }, now)[0]).toEqual({ tool: "get_equity_historicals", arguments: { symbols: ["SPY"], interval: "day", bounds: "regular", start_time: "2026-09-22T14:00:00.000Z", end_time: "2026-10-22T14:00:00.000Z" } })
  expect(plan("option_chain", { symbol: "QQQ" })).toEqual([{ tool: "get_option_chains", arguments: { underlying_symbol: "QQQ" } }])
  expect(plan("option_instruments", { symbol: "QQQ", expiry: "2026-11-06", type: "put", strike: 715 })[0].arguments).toEqual({ chain_symbol: "QQQ", expiration_dates: "2026-11-06", type: "put", state: "active", strike_price: "715.0000" })
  expect(plan("option_quotes", { ids: ["3b912aa2-88f9-4682"] })[0]).toEqual({ tool: "get_option_quotes", arguments: { instrument_ids: ["3b912aa2-88f9-4682"] } })
  const bad = (n, a, m) => expect(() => plan(n, a)).toThrow(m)
  bad("quotes", { symbols: [] }, "symbols: 1–10 tickers")
  bad("quotes", { symbols: Array(11).fill("SPY") }, "symbols: 1–10 tickers")
  bad("quotes", { symbols: ["SP Y;rm"] }, "a ticker in capitals")
  bad("bars", { symbol: "SPY", interval: "1second" }, "interval:")
  bad("bars", { symbol: "SPY", interval: "day", days: 365 }, "days: a whole number 1–30")
  bad("option_instruments", { symbol: "QQQ", expiry: "Nov 6", type: "put" }, "expiry: YYYY-MM-DD")
  bad("option_instruments", { symbol: "QQQ", expiry: "2026-11-06", type: "straddle" }, "type: call | put")
  bad("option_quotes", { ids: ["../../etc"] }, "ids: 1–20 instrument ids")
  bad("index_quote", { symbol: "FOO" }, "symbol: VIX | SPX")
})

test("index_quote is two calls: the index's id, then its quote", async () => {
  const calls = []
  const call = async (c) => (calls.push(c), c.tool === "get_indexes" ? JSON.stringify({ data: { indexes: [{ id: "abc-123-def" }] } }) : '{"value":"16.68"}')
  const r = await bridgeCall("index_quote", { symbol: "VIX" }, { call })
  expect(calls.map((c) => c.tool)).toEqual(["get_indexes", "get_index_quotes"])
  expect(calls[1].arguments).toEqual({ instrument_ids: ["abc-123-def"] })
  expect(r.content[0].text).toBe('{"value":"16.68"}')
})

test("the host caller posts mcp/call as the desk, same-origin; a refusal is an error", async () => {
  const seen = []
  const f = async (url, opts) => (seen.push({ url, opts }), new Response(JSON.stringify({ ok: true, value: { text: "{}", isError: false } }), { status: 200 }))
  expect(await hostCaller({ port: 1111, desk: "trade-card", fetch: f })({ tool: "get_equity_quotes", arguments: { symbols: ["SPY"] } })).toBe("{}")
  expect(seen[0].url).toBe("http://localhost:1111/__askk/mcp/call")
  expect(seen[0].opts.headers).toMatchObject({ origin: "http://localhost:1111", "x-askk-desk": "trade-card" })
  expect(JSON.parse(seen[0].opts.body)).toEqual({ server: "robinhood", tool: "get_equity_quotes", arguments: { symbols: ["SPY"] } })
  const refused = async () => new Response(JSON.stringify({ ok: false, error: "trade-card: robinhood.place_order is refused" }), { status: 403 })
  await expect(hostCaller({ port: 1, desk: "d", fetch: refused })({ tool: "x", arguments: {} })).rejects.toThrow("is refused")
})

test("stdio JSON-RPC: initialize, tools/list, tools/call, unknown method", async () => {
  const out = []
  const input = new Response(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}', '{"jsonrpc":"2.0","method":"notifications/initialized"}', '{"jsonrpc":"2.0","id":2,"method":"tools/list"}', '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"quotes","arguments":{"symbols":["SPY"]}}}', '{"jsonrpc":"2.0","id":4,"method":"resources/list"}', ""].join("\n")).body
  await serve({ call: async () => '{"SPY":773.1}', input, write: (s) => out.push(JSON.parse(s)) })
  const by = Object.fromEntries(out.map((m) => [m.id, m]))
  expect(by[1].result.serverInfo.name).toBe("askk-market")
  expect(by[2].result.tools).toHaveLength(10)
  expect(by[3].result.content[0].text).toBe('{"SPY":773.1}')
  expect(by[4].error.code).toBe(-32601)
  expect(out).toHaveLength(4) // the notification has no answer
})

describe("order tools (--orders <account>)", () => {
  const leg = { option_id: "abcdef12-3456", side: "buy", position_effect: "open" }
  test("refused without an order account", () => {
    expect(() => plan("place_option_order", { legs: [leg], quantity: 1, price: 1.2 })).toThrow("orders are off")
  })
  test("a buy-to-open → place_option_order on the account, limit debit", () => {
    const [s] = plan("place_option_order", { legs: [leg], quantity: 1, price: 1.234 }, new Date(), { account: "123" })
    expect(s.tool).toBe("place_option_order")
    expect(s.arguments).toMatchObject({ account_number: "123", direction: "debit", type: "limit", quantity: "1", price: "1.23" })
  })
  test("bad legs refused", () => {
    expect(() => plan("place_option_order", { legs: [{ ...leg, side: "short" }], quantity: 1, price: 1 }, new Date(), { account: "1" })).toThrow("side")
    expect(() => plan("place_option_order", { legs: [leg], quantity: 0.5, price: 1 }, new Date(), { account: "1" })).toThrow("quantity")
  })
  test("reads and cancel", () => {
    expect(plan("portfolio", {}, new Date(), { account: "9" })[0]).toEqual({ tool: "get_portfolio", arguments: { account_number: "9" } })
    expect(plan("cancel_option_order", { order_id: "ord-12345678" }, new Date(), { account: "9" })[0].tool).toBe("cancel_option_order")
  })
})

test("data: only servers that declare research: true are listed, as <server>__<tool>; calls go to mcp/call as that server", async () => {
  const servers = [
    { name: "robinhood", ok: true, tools: [{ name: "place_option_order" }] },
    { name: "openalice", ok: true, research: true, title: "OpenAlice", tools: [{ name: "economyFredSeries", description: "FRED", inputSchema: { type: "object", properties: { symbol: { type: "string" } } } }, { name: "bad name!" }] },
    { name: "down", ok: false, research: true, tools: [{ name: "x" }] },
  ]
  const tools = dataTools(servers)
  expect(tools.map((t) => t.name)).toEqual(["openalice__economyFredSeries"])
  const calls = []
  const data = { list: async () => tools, call: async (c) => (calls.push(c), "[{\"DGS10\":5.13}]") }
  expect((await dataCall("openalice__economyFredSeries", { symbol: "DGS10" }, data)).content[0].text).toContain("5.13")
  expect(calls).toEqual([{ server: "openalice", tool: "economyFredSeries", arguments: { symbol: "DGS10" } }])
  const refused = await dataCall("robinhood__place_option_order", {}, data)
  expect(refused.isError).toBe(true)
  expect(calls.length).toBe(1)
})

test("data: the host listing is read as the desk", async () => {
  let seen = null
  const list = hostTools({ port: 1111, desk: "trade-card", fetch: async (url, init) => ((seen = { url, init }), new Response(JSON.stringify({ servers: [{ name: "openalice" }] }))) })
  expect(await list()).toEqual([{ name: "openalice" }])
  expect(seen.url).toBe("http://localhost:1111/__askk/mcp/tools")
  expect(seen.init.headers["x-askk-desk"]).toBe("trade-card")
})
