import { test, expect } from "bun:test"

import { AGENTS_DIR, BUILTIN_DIR, loadAgents } from "../core/registry.js"
import { memoryFs, fixedClock } from "../core/ports/memory-fs.js"
import { State, Status } from "../core/state.js"
import { defaultPorts } from "../core/ports.js"

const WORKER = new URL("./registry-worker.js", import.meta.url).href

/** @param {string} name @param {string[]} tools @returns {string} */
const agentFile = (name, tools = []) =>
  `---\nname: ${name}\ntools: [${tools.join(", ")}]\n---\nYou are ${name}.\n`

/**
 * A tree with a main that names one helper, the three built-in machinery
 * agents, and a project summarizer shadowing the built-in one.
 * @param {Record<string, string>} [extra]
 */
function tree(extra = {}) {
  return {
    [`${BUILTIN_DIR}/summarizer/agent.md`]: agentFile("summarizer"),
    [`${BUILTIN_DIR}/verifier/agent.md`]: agentFile("verifier"),
    [`${BUILTIN_DIR}/critic/agent.md`]: agentFile("critic"),
    [`${AGENTS_DIR}/main/agent.md`]: agentFile("main", ["helper"]),
    [`${AGENTS_DIR}/helper/agent.md`]: agentFile("helper"),
    [`${AGENTS_DIR}/summarizer/agent.md`]: agentFile("summarizer"),
    ...extra,
  }
}

/** @param {Record<string, string>} files */
function harness(files) {
  const state = new State(fixedClock("2026-08-16T12:00:00-07:00"))
  const ports = {
    ...defaultPorts(),
    fs: memoryFs({ files }),
    spawnWorker: (/** @type {string} */ url) => /** @type {any} */ (new Worker(url, { type: "module" })),
  }
  return { state, ports: /** @type {any} */ (ports) }
}

/** @param {Record<string, string>} [files] */
function load(files = tree()) {
  const { state, ports } = harness(files)
  return { state, main: loadAgents({ ports, state, workerUrl: WORKER }) }
}

test("a worker agent invokes and answers", async () => {
  const { main, state } = load()
  const agent = await main
  expect(await agent.invoke("hello")).toBe("main heard: hello")
  // The transcript rode back with the answer, because it cannot be a live view.
  expect(agent.messages).toEqual([
    { role: "user", content: "hello" },
    { role: "assistant", content: "main heard: hello" },
  ])
  // Only the agent a person holds can be waiting on one.
  expect(state.get("main")?.status).toBe(Status.WAITING)
  expect(state.get("helper")?.status).toBe(Status.IDLE)
  await agent.close()
})

test("a sub-agent named in frontmatter arrives as a tool, and the call crosses", async () => {
  const agent = await load().main
  expect(await agent.invoke("tools")).toBe("helper")
  expect(await agent.invoke("delegate helper fetch the thing")).toBe("helper heard: fetch the thing")
  await agent.close()
})

test("the summarizer is distributed to everyone and is nobody's tool", async () => {
  const agent = await load().main
  expect(await agent.invoke("tools")).not.toContain("summarizer")
  expect(await agent.invoke("role summarizer")).toContain("agent summarizer")
  expect(await agent.invoke("role verifier")).toContain("agent verifier")
  expect(await agent.invoke("role critic")).toContain("agent critic")
  await agent.close()
})

test("a same-named project agent replaces the built-in rather than doubling it", async () => {
  const { main, state } = load()
  const agent = await main
  // One summarizer, and it is the project's — the folder it was loaded from
  // rides along in the description.
  expect(await agent.invoke("role summarizer")).toBe(`agent summarizer from ${AGENTS_DIR}`)
  expect(state.snapshot().filter((row) => row.name === "summarizer")).toHaveLength(1)
  expect(state.get("summarizer")?.builtin).toBe(false)
  expect(state.get("verifier")?.builtin).toBe(true)
  await agent.close()
})

test("a broken agent is skipped with an error and does not take the load down", async () => {
  const { main, state } = load(tree({ [`${AGENTS_DIR}/broken/agent.md`]: agentFile("broken") }))
  const agent = await main
  expect(agent.name).toBe("main")
  expect(state.get("broken")?.status).toBe(Status.FAILED)
  expect(state.get("broken")?.detail).toBe("no engine for you")
  expect(agent.peers.map((peer) => peer.name)).not.toContain("broken")
  await agent.close()
})

test("closing the main agent closes every peer it owns", async () => {
  const { main, state } = load()
  const agent = await main
  expect(agent.peers.map((peer) => peer.name).sort()).toEqual(["critic", "helper", "summarizer", "verifier"])
  await agent.close()
  for (const row of state.snapshot()) expect(row.status).toBe(Status.CLOSED)
  // The workers are gone, so a call on one can never be answered.
  await expect(agent.invoke("anyone there?")).rejects.toThrow("worker stopped")
})

test("the messages call re-reads a transcript out of turn", async () => {
  const agent = await load().main
  await agent.invoke("hello")
  const { messages } = await agent.worker.run({ type: "messages" })
  expect(messages).toEqual(agent.messages)
  await agent.close()
})

test("no main agent is a load error naming what was found", async () => {
  const files = /** @type {Record<string, string>} */ ({ ...tree() })
  delete files[`${AGENTS_DIR}/main/agent.md`]
  await expect(load(files).main).rejects.toThrow(`No main agent 'main' in ${AGENTS_DIR}`)
})
