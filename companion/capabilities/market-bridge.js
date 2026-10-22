// A read-only market-data MCP server for research calls (2026-10-22 owner: "give it the Robin Hood MCP tools for any
// live market data"). The research CLI (research.js) starts it over stdio when a desk's stage asks for `market`; it
// exposes a FIXED allowlist of read tools and answers each by calling back into the host that started the call —
// `POST /__askk/mcp/call` on localhost:<port> as <desk> — so the broker's token never leaves the host, the desk's own
// guard (its host() checks, e.g. a read-only set) still applies, and no trading tool is reachable unless the call asked for orders (below).
//
//   bun market-bridge.js --port <host port> --desk <desk> [--server robinhood]
//
// Tools (each argument checked; anything else refused):
//   quotes {symbols: [≤ 10 tickers]}                       → get_equity_quotes
//   bars {symbol, interval: 5minute | 10minute | hour | day | week, days: 1–30}  → get_equity_historicals (regular)
//   option_chain {symbol}                                  → get_option_chains (the expirations)
//   option_instruments {symbol, expiry YYYY-MM-DD, type: call | put, strike?}  → get_option_instruments (active)
//   option_quotes {ids: [≤ 20 instrument ids]}             → get_option_quotes
//   index_quote {symbol: VIX | SPX | NDX | RUT | DJX}       → get_indexes + get_index_quotes
// An answer is the server's text, clipped to 20 000 characters.

const TICKER = /^[A-Z][A-Z0-9.^-]{0,9}$/
const ID = /^[A-Za-z0-9-]{8,64}$/
const INTERVALS = ["5minute", "10minute", "hour", "day", "week"]
const INDEXES = ["VIX", "SPX", "NDX", "RUT", "DJX"]
const CLIP = 20000

const bad = (msg) => {
  throw Object.assign(new Error(msg), { bad: true })
}
const ticker = (v, what = "symbol") => {
  const s = String(v ?? "").toUpperCase()
  if (!TICKER.test(s)) bad(`${what}: a ticker in capitals`)
  return s
}

export const BRIDGE_TOOLS = [
  { name: "quotes", description: "Live quotes for up to 10 stock/ETF tickers: last (regular and extended), bid/ask, prior close.", inputSchema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["symbols"] } },
  { name: "bars", description: "Price bars for one ticker, regular session: interval 5minute | 10minute | hour | day | week, the last `days` days (1–30).", inputSchema: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string", enum: INTERVALS }, days: { type: "number" } }, required: ["symbol", "interval"] } },
  { name: "option_chain", description: "The option chain of a ticker: its expiration dates and chain id.", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "option_instruments", description: "Active option contracts of a ticker for one expiry (YYYY-MM-DD) and type (call | put), optionally one strike: their instrument ids.", inputSchema: { type: "object", properties: { symbol: { type: "string" }, expiry: { type: "string" }, type: { type: "string", enum: ["call", "put"] }, strike: { type: "number" } }, required: ["symbol", "expiry", "type"] } },
  { name: "option_quotes", description: "Quotes for up to 20 option instrument ids: bid/ask, mark, IV, greeks, prior close.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, maxItems: 20 } }, required: ["ids"] } },
  { name: "index_quote", description: "The value of an index: VIX | SPX | NDX | RUT | DJX.", inputSchema: { type: "object", properties: { symbol: { type: "string", enum: INDEXES } }, required: ["symbol"] } },
]
export const BRIDGE_NAMES = BRIDGE_TOOLS.map((t) => t.name)

// Order tools (2026-10-22, `--orders <account>` owner: "the local Robin Hood tools to gather all the data and also place the orders"), only
// with --orders (research body tools: ["orders"]). Each goes to the host's mcp/call as the desk, so the desk's guard
// decides: trade-card's runs place_option_order through the order guard (.env caps: ASKK_ORDERS=live, the account,
// contracts, $ per order and per day, opens per day, the window, the day stop) — no argument here can loosen it.
const LEG = { type: "object", properties: { option_id: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] }, position_effect: { type: "string", enum: ["open", "close"] }, ratio_quantity: { type: "number" } }, required: ["option_id", "side", "position_effect"] }
export const ORDER_TOOLS = [
  { name: "portfolio", description: "The order account's value, cash and buying power.", inputSchema: { type: "object", properties: {} } },
  { name: "option_positions", description: "The order account's open option positions.", inputSchema: { type: "object", properties: {} } },
  { name: "option_orders", description: "The order account's option orders, or one by id.", inputSchema: { type: "object", properties: { order_id: { type: "string" } } } },
  { name: "place_option_order", description: "A REAL limit option order on the order account: legs [{option_id, side, position_effect, ratio_quantity?}], quantity, price (per contract). Opening = buy (or a debit spread) only, inside the owner's .env caps; closing always allowed. Refusals name the cap.", inputSchema: { type: "object", properties: { legs: { type: "array", items: LEG, minItems: 1, maxItems: 4 }, quantity: { type: "number" }, price: { type: "number" } }, required: ["legs", "quantity", "price"] } },
  { name: "cancel_option_order", description: "Cancel one open option order by id.", inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } },
]
export const ORDER_NAMES = ORDER_TOOLS.map((t) => t.name)

// One tool call → the broker calls it makes, in order: [{tool, arguments}] (a function of the previous answer for the
// two-step index quote). Pure: checks the arguments, never reaches the network.
export function plan(name, args = {}, now = new Date(), { account = null } = {}) {
  const a = args && typeof args === "object" ? args : {}
  if (name === "quotes") {
    if (!Array.isArray(a.symbols) || !a.symbols.length || a.symbols.length > 10) bad("symbols: 1–10 tickers")
    return [{ tool: "get_equity_quotes", arguments: { symbols: [...new Set(a.symbols.map((s) => ticker(s, "symbols[]")))] } }]
  }
  if (name === "bars") {
    if (!INTERVALS.includes(a.interval)) bad(`interval: ${INTERVALS.join(" | ")}`)
    const days = a.days == null ? 2 : Number(a.days)
    if (!Number.isInteger(days) || days < 1 || days > 30) bad("days: a whole number 1–30")
    return [{ tool: "get_equity_historicals", arguments: { symbols: [ticker(a.symbol)], interval: a.interval, bounds: "regular", start_time: new Date(now - days * 864e5).toISOString(), end_time: now.toISOString() } }]
  }
  if (name === "option_chain") return [{ tool: "get_option_chains", arguments: { underlying_symbol: ticker(a.symbol) } }]
  if (name === "option_instruments") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.expiry ?? ""))) bad("expiry: YYYY-MM-DD")
    if (!["call", "put"].includes(a.type)) bad("type: call | put")
    const out = { chain_symbol: ticker(a.symbol), expiration_dates: a.expiry, type: a.type, state: "active" }
    if (a.strike != null) {
      if (!(Number(a.strike) > 0)) bad("strike: a positive number")
      out.strike_price = Number(a.strike).toFixed(4)
    }
    return [{ tool: "get_option_instruments", arguments: out }]
  }
  if (name === "option_quotes") {
    if (!Array.isArray(a.ids) || !a.ids.length || a.ids.length > 20 || a.ids.some((x) => !ID.test(String(x)))) bad("ids: 1–20 instrument ids")
    return [{ tool: "get_option_quotes", arguments: { instrument_ids: a.ids.map(String) } }]
  }
  if (name === "index_quote") {
    if (!INDEXES.includes(a.symbol)) bad(`symbol: ${INDEXES.join(" | ")}`)
    return [
      { tool: "get_indexes", arguments: { symbols: a.symbol } },
      (prev) => {
        let id = null
        try {
          id = (JSON.parse(prev).data?.indexes ?? [])[0]?.id ?? null
        } catch {}
        if (!id) bad(`no index ${a.symbol}`)
        return { tool: "get_index_quotes", arguments: { instrument_ids: [id] } }
      },
    ]
  }
  if (ORDER_NAMES.includes(name)) {
    if (!account) bad("orders are off on this call (no order account)")
    const acct = { account_number: account }
    if (name === "portfolio") return [{ tool: "get_portfolio", arguments: acct }]
    if (name === "option_positions") return [{ tool: "get_option_positions", arguments: acct }]
    if (name === "option_orders") return [{ tool: "get_option_orders", arguments: a.order_id ? { ...acct, order_id: String(a.order_id) } : acct }]
    if (name === "cancel_option_order") {
      if (!ID.test(String(a.order_id ?? ""))) bad("order_id: an order id")
      return [{ tool: "cancel_option_order", arguments: { ...acct, order_id: String(a.order_id) } }]
    }
    const legs = Array.isArray(a.legs) ? a.legs : []
    if (!legs.length || legs.length > 4) bad("legs: 1–4")
    const out = legs.map((l) => {
      if (!ID.test(String(l?.option_id ?? ""))) bad("legs[].option_id: an instrument id")
      if (!["buy", "sell"].includes(l.side)) bad("legs[].side: buy | sell")
      if (!["open", "close"].includes(l.position_effect)) bad("legs[].position_effect: open | close")
      const r = l.ratio_quantity == null ? 1 : Number(l.ratio_quantity)
      if (!Number.isInteger(r) || r < 1) bad("legs[].ratio_quantity: a whole number ≥ 1")
      return { option_id: String(l.option_id), side: l.side, position_effect: l.position_effect, ratio_quantity: r }
    })
    const q = Number(a.quantity)
    if (!Number.isInteger(q) || q < 1) bad("quantity: a whole number ≥ 1")
    if (!(Number(a.price) > 0)) bad("price: a positive limit")
    const debit = out.length === 1 ? out[0].side === "buy" : out.some((l) => l.side === "buy")
    return [{ tool: "place_option_order", arguments: { ...acct, legs: out, direction: debit ? "debit" : "credit", type: "limit", quantity: String(q), price: Number(a.price).toFixed(2), time_in_force: "gfd" } }]
  }
  bad(`unknown tool ${name} (tools: ${BRIDGE_NAMES.join(", ")})`)
}

// The host's mcp/call, as the desk: → the answer's text (throws on an HTTP error or an isError answer).
export const hostCaller =
  ({ port, desk, server = "robinhood", fetch: f = fetch }) =>
  async ({ tool, arguments: args }) => {
    const r = await f(`http://localhost:${port}/__askk/mcp/call`, { method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${port}`, "x-askk-desk": desk }, body: JSON.stringify({ server, tool, arguments: args }) })
    const body = await r.json().catch(() => null)
    if (!r.ok || body?.ok === false) throw new Error(body?.error ?? `host ${r.status}`)
    const v = body?.value ?? body
    if (v?.isError) throw new Error(String(v.text ?? "the broker refused").slice(0, 400))
    return String(v?.text ?? JSON.stringify(v))
  }

// One tools/call → MCP content.
export async function bridgeCall(name, args, { call, now = new Date(), account = null }) {
  try {
    let prev = null
    for (const step of plan(name, args, now, { account })) prev = await call(typeof step === "function" ? step(prev) : step)
    const text = prev.length > CLIP ? `${prev.slice(0, CLIP)}\n… (clipped at ${CLIP} characters)` : prev
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return { content: [{ type: "text", text: `${name}: ${error.message}` }], isError: true }
  }
}

// JSON-RPC over stdio, one message per line (the MCP stdio transport).
export async function serve({ call, account = null, input = Bun.stdin.stream(), write = (s) => process.stdout.write(s) }) {
  const send = (msg) => write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`)
  const handle = async (m) => {
    if (m.id == null) return // a notification (initialized, cancelled)
    if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "askk-market", version: "1.0.0" } } })
    if (m.method === "tools/list") return send({ id: m.id, result: { tools: account ? [...BRIDGE_TOOLS, ...ORDER_TOOLS] : BRIDGE_TOOLS } })
    if (m.method === "tools/call") return send({ id: m.id, result: await bridgeCall(m.params?.name, m.params?.arguments, { call, account }) })
    if (m.method === "ping") return send({ id: m.id, result: {} })
    send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } })
  }
  const pending = []
  let buffer = ""
  for await (const chunk of input.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    let at
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (!line) continue
      let m
      try {
        m = JSON.parse(line)
      } catch {
        send({ id: null, error: { code: -32700, message: "parse error" } })
        continue
      }
      pending.push(handle(m).catch((error) => send({ id: m.id ?? null, error: { code: -32603, message: error.message } })))
    }
  }
  await Promise.all(pending)
}

if (import.meta.main) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null)
  const port = Number(arg("--port"))
  const desk = arg("--desk")
  if (!Number.isInteger(port) || port <= 0 || !desk) {
    console.error("market-bridge: --port <host port> --desk <desk> required")
    process.exit(2)
  }
  // --orders: the order tools on the account the owner's .env names (the desk's guard checks it again)
  const account = arg("--orders")
  await serve({ call: hostCaller({ port, desk, server: arg("--server") ?? "robinhood" }), account })
}
