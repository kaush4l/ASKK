// Path containment: `abs` (already realpath-resolved) is `root` or below it.
import { sep } from "node:path"

export const within = (root, abs) => abs === root || abs.startsWith(root + sep)
