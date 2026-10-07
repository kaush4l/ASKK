// Artifact — an object an engine keeps beside its conversation, rendered
// into the prompt as its latest state only (never as a log of changes).
//
//   state      plain, JSON-safe; owned by one engine, saved with its memory
//              (agents/<engine>/artifacts.json) and restored at startup
//   refresh()  bring the view up to date with its source; the engine calls
//              it before every LLM step
//   render()   the latest state as prompt text (the ARTIFACTS section)
//   commands() tools that change the state; their results stay short, since
//              the content itself is in the next render
//   live()     what the UI shows of it (Live follow), JSON-safe:
//              { view: "filesystem" | "terminal" | "checklist" | …, data } or null.
//              The engine publishes it whenever it changes (state.live[type],
//              with a version): artifacts update the UI as events, not polls.
//
// Design and roadmap: docs/artifacts.md.
//
// Subclasses set `static type` (the name agent.md lists under `artifacts:`)
// and `static title`, and register in features/index.js.

export class Artifact {
  static type = "artifact"
  static title = "ARTIFACT"

  // engine: the BaseEngine that owns this artifact. onChange(): called after
  // every state change (the engine saves and publishes it).
  constructor({ engine, state = null, onChange = () => {} }) {
    if (new.target === Artifact) throw new Error("Artifact is abstract; subclass it.")
    this.engine = engine
    this.onChange = onChange
    this.state = { ...this.initialState(), ...(state ?? {}) }
  }

  get type() {
    return this.constructor.type
  }

  initialState() {
    return {}
  }

  setState(patch) {
    this.state = { ...this.state, ...patch }
    this.onChange()
  }

  // Back to the initial state (e.g. when the conversation is cleared).
  reset() {
    this.state = this.initialState()
    this.onChange()
  }

  async refresh() {}

  render() {
    return ""
  }

  commands() {
    return []
  }

  live() {
    return null
  }

  toJSON() {
    return this.state
  }
}
