/**
 * A transformers.js load event, in the shape a page can draw.
 *
 * One reader, two writers: the speech services and the chat transport both
 * load weights through the same library and both report the same four facts.
 * This lived inside `SpeechService` while it had one caller; a second caller is
 * what earns it a file, exactly as `browserHttp` was moved when `agentWorker`
 * became its second.
 *
 * `percent` is rounded here rather than at the view, because a bar is drawn
 * from it and a number with fourteen decimal places in a `width` is a style
 * recalculated on every chunk.
 */
export function describeProgress(event) {
  return {
    status: event?.status ?? 'progress',
    file: event?.file ?? '',
    loaded: event?.loaded ?? 0,
    total: event?.total ?? 0,
    percent: Math.round(event?.progress ?? 0),
  }
}
