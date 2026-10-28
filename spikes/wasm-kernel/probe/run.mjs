import { team } from "./js/p.js"
const r = team.ask("x")
console.log("ask returned:", r instanceof Promise ? "Promise → " + (await r) : r)
