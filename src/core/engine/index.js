import { Outcome } from '../Outcome.js'
import { Engine } from './Engine.js'
import { ReActEngine } from './ReActEngine.js'

/** Loop name -> class, so an engine can be configured by string. */
export const ENGINES = {
  [ReActEngine.LABEL]: ReActEngine,
}

export const DEFAULT_LOOP = ReActEngine.LABEL

/**
 * Build an engine, correcting an unrecognised loop instead of refusing.
 *
 * @returns {Outcome} value is an Engine
 */
export function createEngine({ loop = DEFAULT_LOOP, ...settings }) {
  const notes = []
  let chosen = loop
  if (!ENGINES[chosen]) {
    notes.push(`loop ${JSON.stringify(loop)} is not available; used ${DEFAULT_LOOP} instead`)
    chosen = DEFAULT_LOOP
  }
  return Outcome.ok(new ENGINES[chosen](settings), notes)
}

export { Engine, ReActEngine }
