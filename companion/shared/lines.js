// The lines of a process's output stream (bytes or text chunks), as they arrive. A last line with no newline is yielded
// only with `rest` (otherwise dropped, as a half-written message is).
export async function* streamLines(stream, { rest = false } = {}) {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    let at
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      yield line
    }
  }
  if (rest) yield buffer
}
