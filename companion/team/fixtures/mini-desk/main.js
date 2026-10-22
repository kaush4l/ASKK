// A desk small enough to mount in another (sample-desk's beta: desks: [mini-desk]) and to run alone. Its own
// artifact type (tally), step limit and fallback model apply wherever it composes, mounted or alone. It keeps the
// legacy layout (agents/mini/agent.md, before 2026-10-21): a desk in it composes unchanged, and mounts in a standard one.
import { conventionDesk } from "../../compose.js"
import { tally } from "./artifacts/tally.js"

export default conventionDesk({ title: "Mini desk", description: "Shouts: the standard's mounted-desk example.", artifacts: { tally }, maxSteps: 5, fallbacks: ["haiku"] })
