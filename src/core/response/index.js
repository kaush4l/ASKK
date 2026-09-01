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

export { BaseResponse } from './BaseResponse.js'
export { ACT_ANSWER, ACT_TOOL, ReActResponse } from './ReActResponse.js'
export { SimpleResponse }
