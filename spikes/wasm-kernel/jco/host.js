// askk:spike/host for the jco run (Node or a browser tab): the same policy as backend/browser/host.js —
// the host decides what the component may touch. Granted: /desk → ../lane. Anything else is refused.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import { scripted } from "./model.js"

const LANE = new URL("../lane/", import.meta.url).pathname
const granted = (path) => {
  const p = normalize(path)
  if (!p.startsWith("/desk/")) throw `${path}: outside the folders this desk was granted (/desk)`
  return join(LANE, p.slice("/desk/".length))
}
export const fsRead = (path) => readFileSync(granted(path), "utf8")
export const fsWrite = (path, text) => {
  const real = granted(path)
  mkdirSync(dirname(real), { recursive: true })
  writeFileSync(real, text)
}
export const complete = (prompt) => scripted(prompt)
export const log = (line) => console.log("[kernel]", line)
