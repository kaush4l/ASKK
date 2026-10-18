import { defineTool } from "../../../../../backend/kernel/index.js"

// Where a call runs: the desk and the memory folder its ctx names (a mounted desk keeps its own).
export default defineTool({
  name: "where",
  description: "the desk and memory folder this tool runs as",
  input: {},
  run: async (_, ctx) => `${ctx.desk} ${ctx.memory ?? "(no memory)"}`,
})
