import { defineTool } from "../../../../backend/kernel/index.js"

// Fails on purpose: a tool without a description (defineTool refuses it when the module loads).
export default defineTool({ name: "broken", input: {}, run: async () => "never" })
