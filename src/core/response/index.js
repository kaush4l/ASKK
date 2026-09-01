import { ReActResponse } from './ReActResponse.js'
import { SimpleResponse } from './SimpleResponse.js'

/** Name -> class, so an engine can be configured by string. */
export const RESPONSE_MODELS = {
  simple: SimpleResponse,
  react: ReActResponse,
}

/** An unknown name falls back to the ReAct contract rather than refusing. */
export function getResponseModel(name) {
  return RESPONSE_MODELS[name] ?? ReActResponse
}
