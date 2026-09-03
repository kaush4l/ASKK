import { json } from './json.js'
import { toon } from './toon.js'

/** Format name -> the pair of functions that write the contract. */
export const FORMATS = { [toon.name]: toon, [json.name]: json }

export const DEFAULT_FORMAT = toon.name

/** An unknown name falls back rather than refusing, like every other registry here. */
export function getFormat(name) {
  return FORMATS[name] ?? FORMATS[DEFAULT_FORMAT]
}
