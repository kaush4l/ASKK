import { BaseResponse } from './BaseResponse.js'

/** Think, then answer. Only `response` reaches the user. */
export class SimpleResponse extends BaseResponse {
  static FIELDS = {
    thinking: {
      description:
        'Your private reasoning. The user never sees this — think here, not in the answer.',
    },
    response: {
      description:
        'The reply shown to the user. Self-contained, no meta-commentary about your reasoning.',
    },
  }
}
