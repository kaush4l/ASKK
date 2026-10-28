// The ASKK kernel as a WebAssembly component (spike, 2026-10-26; docs/portability.md §5).
// The real kernel (backend/kernel) builds one agent; its only doors out are the askk:spike/host imports — a file it
// was not granted, a model it was not given, a process: none of these exist inside the component.
import { fsRead, fsWrite, complete, log } from "askk:spike/host@0.1.0"
import { Agent, Tool } from "../../../backend/kernel/index.js"

const tools = [
  new Tool({
    name: "fs.read",
    description: "Read a text file. Answers its text, or why not.",
    input: { path: "the file" },
    run: ({ path }) => fsRead(path),
  }),
  new Tool({
    name: "fs.write",
    description: "Write a text file. Answers what was written, or why not.",
    input: { path: "the file", text: "its text" },
    run: ({ path, text }) => {
      fsWrite(path, text)
      return `wrote ${text.length} chars to ${path}`
    },
  }),
]

// One model call through the host: the rendered prompt out, the reply (the kernel's reply format) back.
const infer = async (prompt) => complete(prompt)

export const team = {
  async ask(request) {
    const lead = new Agent({ name: "lead", report: false, maxSteps: 8, role: "You are a lead agent running inside a WebAssembly sandbox." }, { infer, tools })
    lead.on("call", (e) => log(`call ${e.tool} ${JSON.stringify(e.input)}`))
    lead.on("result", (e) => log(`result ${e.tool} ${e.ok ? "ok" : "FAILED"}: ${String(e.output).slice(0, 160)}`))
    const out = await lead.ask(request)
    return typeof out === "string" ? out : JSON.stringify(out?.answer ?? out)
  },
}
