// Engine classes by strategy. An agent's `strategy:` (agent.md, default
// "react") picks the class; every class extends BaseEngine and implements
// its own run().

import { ReActEngine } from "@/backend/engines/react-engine"

export { BaseEngine } from "@/backend/core/base-engine"
export { ReActEngine }

export const ENGINES = { [ReActEngine.strategy]: ReActEngine }

export function createEngine(options) {
  const strategy = options.agent.strategy ?? "react"
  const Engine = ENGINES[strategy]
  if (!Engine) throw new Error(`Unknown strategy "${strategy}" for ${options.agent.name}. Known: ${Object.keys(ENGINES).join(", ")}.`)
  return new Engine(options)
}
