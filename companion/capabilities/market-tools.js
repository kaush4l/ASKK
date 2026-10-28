// The market bridge's read tools as kernel tools (2026-10-25 owner: "Build the market kernel tools" —
// docs/portable-workflows.md): the same read tools a research call reaches over stdio MCP (market-bridge.js), for an agent
// on the kernel's own loop on any model (a workflow step agent, a lead). One definition, two transports: the names,
// descriptions and argument checks are the bridge's (BRIDGE_TOOLS, plan); each broker call goes through the desk's host
// (`ctx.host.post("mcp/call", {server, tool, arguments})`), so the token stays in the host and the desk's guard decides.
// Read-only: the order tools are never built here.
//
//   marketTools({server?, clock?}) → [Tool market.quotes, market.bars, market.option_chain, market.option_instruments,
//                                      market.option_quotes, market.index_quote]

import { Tool } from "../../backend/kernel/index.js"
import { BRIDGE_TOOLS, bridgeCall } from "./market-bridge.js"

// A kernel tool's inputs are text fields: each bridge argument named with its type and what it takes.
function inputOf(schema) {
  const req = new Set(schema.required ?? [])
  const out = {}
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    const what = p.type === "array" ? `a list (comma-separated or [..])${p.maxItems ? `, ≤ ${p.maxItems}` : ""}` : p.enum ? p.enum.join(" | ") : p.type
    out[req.has(k) ? k : `${k}?`] = what
  }
  return out
}

// The reply format hands a list as text or JSON, a number as a number or text: back to the bridge's argument types.
export function argsOf(schema, input = {}) {
  const out = {}
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    let v = input?.[k]
    if (v == null || v === "") continue
    if (p.type === "array" && !Array.isArray(v)) v = String(v).replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    if (p.type === "number" && typeof v !== "number") v = Number(v)
    if (p.type === "string" && typeof v !== "string") v = String(v)
    out[k] = v
  }
  return out
}

export function marketTools({ server = "robinhood", clock = () => new Date() } = {}) {
  return BRIDGE_TOOLS.map(
    (t) =>
      new Tool({
        name: `market.${t.name}`,
        type: "data",
        outside: false,
        description: `${t.description} (Robinhood live, read-only)`,
        input: inputOf(t.inputSchema),
        run: async (input, ctx = {}) => {
          const host = ctx.host
          if (!host?.post) throw new Error(`market.${t.name}: no host (the desk server's mcp/call)`)
          const call = async ({ tool, arguments: args }) => {
            const v = await host.post("mcp/call", { server, tool, arguments: args })
            if (v?.isError) throw new Error(String(v.text ?? "the broker refused").slice(0, 400))
            return typeof v?.text === "string" ? v.text : JSON.stringify(v)
          }
          const r = await bridgeCall(t.name, argsOf(t.inputSchema, input), { call, now: clock() })
          const text = r.content?.[0]?.text ?? ""
          if (r.isError) throw new Error(text)
          return text
        },
      }),
  )
}
