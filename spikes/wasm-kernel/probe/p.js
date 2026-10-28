import { log, complete } from "askk:spike/host@0.1.0"
export const team = {
  async ask(request) {
    await Promise.resolve()
    const r = complete("hi " + request)
    await new Promise((res) => queueMicrotask(res))
    log("probe saw " + r)
    return "probe answered: " + r
  },
}
