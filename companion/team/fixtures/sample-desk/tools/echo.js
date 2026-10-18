import { defineTool } from "../../../../../backend/kernel/index.js"

// The smallest tool: input in, text out; ctx.agent is the caller.
export default defineTool({
  name: "echo",
  description: "repeat a text back, with the caller's name",
  input: { text: "what to repeat" },
  view: "text",
  run: async ({ text }, ctx) => `${ctx.agent?.name ?? "?"} heard: ${text}`,
})
