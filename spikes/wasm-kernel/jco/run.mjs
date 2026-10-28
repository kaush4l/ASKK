import { team } from "../out/js/kernel.js"
const t = performance.now()
const answer = team.ask("Write a hello note in notes/, then prove you cannot write outside your folder.")
console.log("ANSWER:", answer, `(${Math.round(performance.now() - t)} ms)`)
