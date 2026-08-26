/** What an Agent is configured with — the field table, and construction.
 *
 * Pydantic gave the Python this table by reflection: names, defaults, and a
 * `description=` per field. JavaScript has none of that, so it is written out
 * (PORT-MAP R1) as class fields carrying the Python's defaults, and the
 * descriptions are the Python's, unedited. `agent.js` extends this and is the
 * behaviour; the split is the 200-line rule, and it falls where the tiers below
 * already split — `component-base.js`, `response-base.js`, `inference-base.js`.
 */

import { PromptAssembler } from "./assembler.js"
import { Transcript } from "./memory.js"
import { defaultPorts } from "./ports.js"
import { DEFAULT_FORMAT, ReActResponse } from "./responses.js"
import { Session } from "./session.js"
import { SKILLS_DIR } from "./skills.js"
import { Toolbox } from "./tools.js"

/** @typedef {import("./inference.js").Inference} Inference */
/** @typedef {import("./ports.js").Ports} Ports */
/** @typedef {import("./response-base.js").BaseResponse} BaseResponse */
/** @typedef {{ role: "system"|"user"|"assistant", content: string }} Turn */

/** Where `logging.getLogger` went. A pure core does not own a logger, so one
 * arrives at construction and silence is the default.
 * @typedef {{ warning(m: string): void, info(m: string): void, error(m: string): void }} Log */

/** @type {Log} */
export const SILENT = { warning() {}, info() {}, error() {} }

export const DEFAULT_RESPONSE_LAYER = "[ASSISTANT]:"

// The default base recipe, in name form — what an agent.md `components` list
// overrides. Phase components and the response contract are always added by the
// turn itself; this list is only the standing furniture.
export const DEFAULT_COMPONENTS = ["soul", "system", "context", "loaded_skills", "history", "tools"]

/** The fields an option of the same name simply replaces. `inference`, `ports`
 * and `messages` are not among them: the first two have no usable default and
 * the third is seeded into the transcript rather than kept. */
const OPTION_FIELDS = [
  "name", "description", "soul", "system", "responseLayer", "responseModel", "responseFormat",
  "tools", "repeatLimit", "summarizer", "compactAt", "keepRecent", "logPath", "stateless",
  "space", "flow", "maxRounds", "skillsDir", "components", "verifier", "critic", "log",
]

/** What may be handed to an Agent: any field the table below declares, plus the
 * required `inference`, the `ports` it reaches the world through, and
 * `messages` — seed history, adopted by the transcript rather than kept as a
 * field of its own. Derived from the class rather than written out twice: a
 * second copy of twenty-four descriptions is a second copy to get wrong.
 * @typedef {Partial<AgentConfig> & { inference: Inference, ports?: Ports, messages?: Turn[] }} AgentOptions */

/** Every field an Agent has, with the Python's defaults, and the construction
 * that turns options into one. */
export class AgentConfig {
  /** @type {string} */ name = "agent"
  /** @type {string} */ description = ""
  /** who the agent is — rendered first, before everything @type {string} */ soul = ""
  /** system instructions — the block after the soul @type {string} */ system = ""
  /** trailing cue the model completes from @type {string} */ responseLayer = DEFAULT_RESPONSE_LAYER
  /** structured response contract for the react loop. null = plain text.
   * `undefined` and `null` differ at construction: `responseModel: null` is the
   * deliberate ask for plain text, not an absent option.
   * @type {typeof import("./response-base.js").BaseResponse | null} */
  responseModel = ReActResponse
  /** 'toon' or 'json' @type {string} */ responseFormat = DEFAULT_FORMAT
  /** functions, sub-agent engines, or Tool objects @type {unknown[]} */ tools = []
  /** identical tool calls allowed before giving up on it @type {number} */ repeatLimit = 3
  /** anything with `invoke`; null falls back to this agent's model @type {any} */ summarizer = null
  /** compact once the history reaches this many messages. 0 never @type {number} */ compactAt = 75
  /** newest messages surviving a compaction verbatim @type {number} */ keepRecent = 24
  /** this agent's log.txt. "" keeps history in memory @type {string} */ logPath = ""
  /** forget everything between calls; write no history @type {boolean} */ stateless = false
  /** a shared Space, or null @type {any} */ space = null
  /** a key of FLOWS: 'react' = the classic loop; 'full' = the phase graph @type {string} */
  flow = "react"
  /** plan→critique revision rounds before answering anyway @type {number} */ maxRounds = 3
  /** where SKILL.md packages live @type {string} */ skillsDir = SKILLS_DIR
  /** registry names forming the base recipe. null = the default set @type {string[] | null} */
  components = null
  /** fresh-context reviewer with `invoke`. null = own model, bare @type {any} */ verifier = null
  /** fresh-context bar-raiser with `invoke`. null = own model, bare @type {any} */ critic = null
  /** @type {Log} */ log = SILENT
  /** @type {Inference} */ inference
  /** the environment, handed in rather than reached for (PHILOSOPHY S9) @type {Ports} */ ports

  /** @param {AgentOptions} options */
  constructor(options) {
    const given = /** @type {Record<string, any>} */ (options)
    const self = /** @type {Record<string, any>} */ (/** @type {unknown} */ (this))
    for (const field of OPTION_FIELDS) if (given[field] !== undefined) self[field] = given[field]
    this.tools = [...this.tools] // never share the caller's array
    this.inference = options.inference
    this.ports = options.ports ?? defaultPorts()

    this.assembler = new PromptAssembler()
    this.toolbox = Toolbox.withLog(this.log, ...this.tools)
    /** modality providers, run before every inference, never by the model @type {any[]} */
    this.modalities = []
    /** @type {(() => unknown)[]} */ this.closers = []
    /** the repeat guard's ledger: call text -> times seen @type {Map<string, number>} */
    this.seen = new Map()
    /** the newest recorded parse — what `invoke` hands back @type {any} */ this.last = null
    this.transcript = new Transcript({
      name: this.name, logPath: this.logPath, stateless: this.stateless,
      compactAt: this.compactAt, keepRecent: this.keepRecent, ports: this.ports, log: this.log,
    })
    this.#seed(options.messages ?? [])
    this.session = new Session({ messages: this.transcript.messages })
  }

  /** Seed turns are adopted, not re-logged: they were already on disk. The log
   * path is withheld for the length of the seeding so each line is formatted and
   * cached exactly as a live turn's would be without being written back — there
   * is one formatter for a transcript line and it lives in memory.js.
   * @param {Turn[]} seed @returns {void} */
  #seed(seed) {
    this.transcript.logPath = ""
    for (const turn of seed) this.transcript.add(turn.role, turn.content)
    this.transcript.logPath = this.logPath
  }

  /** The live conversation — the transcript's own array, never a copy.
   *
   * The Python kept `self.messages` as a second name for that list, and
   * compaction rebound the transcript's array out from under it: a public
   * attribute that went on describing the conversation as it used to be (F-4).
   * A getter cannot drift.
   * @returns {Turn[]} */
  get messages() {
    return this.transcript.messages
  }
}

/**
 * Python's `getattr(parsed, "is_answer", True)`: a plain-text reply has no such
 * property and is an answer by definition, so only a response object that says
 * otherwise keeps the loop going.
 * @param {unknown} parsed @returns {boolean}
 */
export function isAnswer(parsed) {
  return parsed !== null && typeof parsed === "object" && "isAnswer" in parsed
    ? Boolean(/** @type {{ isAnswer: unknown }} */ (parsed).isAnswer)
    : true
}
