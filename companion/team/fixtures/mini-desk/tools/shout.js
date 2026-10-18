import { defineTool } from "../../../../../backend/kernel/index.js"

export default defineTool({
  name: "shout",
  description: "the text in capitals",
  input: { text: "what to shout" },
  run: async ({ text }) => String(text).toUpperCase(),
})
