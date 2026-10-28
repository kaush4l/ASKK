// A scripted model (deterministic, no key): the replies a model would give, in the kernel's reply format.
// Step 1 writes a note in the granted folder; step 2 tries to escape it and reads the note back; step 3 answers.
const SCRIPT = [
  { thought: "write the note", calls: [{ tool: "fs.write", input: { path: "/desk/notes/hello.md", text: "# Hello from inside the WASM sandbox\n" } }] },
  {
    thought: "try a file outside the grant, then read mine",
    calls: [
      { tool: "fs.write", input: { path: "/etc/askk-escape.txt", text: "should never land" } },
      { tool: "fs.read", input: { path: "/desk/notes/hello.md" } },
    ],
  },
  { thought: "report", calls: [], answer: "Wrote /desk/notes/hello.md and read it back; the write to /etc was refused by the host." },
]
let step = 0
export const scripted = (prompt) => {
  const reply = SCRIPT[step % SCRIPT.length]
  console.log(`[model] step ${(step % SCRIPT.length) + 1}: prompt ${prompt.length} chars (${prompt.split("\n").find((l) => l.startsWith("# ")) ?? ""} …)`)
  step++
  return JSON.stringify(reply)
}
