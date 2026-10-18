import { defineTool } from "../../../../../backend/kernel/index.js"

// A tool that reaches the host: only through ctx.host (companion/team/compose.js hostClient), as its desk.
export default defineTool({
  name: "note.save",
  description: "save a note in the desk's workspace (data/notes/<name>.md)",
  input: { name: "the note's file name, no extension", text: "the note" },
  run: async ({ name, text }, ctx) => {
    const saved = await ctx.host.post("fs/write", { path: `notes/${String(name).replace(/[^\w-]/g, "-")}.md`, text: String(text) })
    return `saved ${saved.path} (${saved.size} bytes)`
  },
})
