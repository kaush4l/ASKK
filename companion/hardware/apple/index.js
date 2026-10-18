// Apple's macOS APIs, reached through the system's own command-line tools,
// for the host API (companion/server/host-api.js). macOS only.
//
//   const apple = await createApple()   null when not on macOS
//   apple.actions                       [{ id, available }]
//   await apple.run(id, inputs)         { text } — the result, as text for the agent
//
// Every action runs a fixed program with an argument list (never a shell),
// with a timeout and a capped output; agent text is passed as arguments or
// stdin, never spliced into a script. A desk that offers these to its agents
// decides who may call them (its host() guard); macOS asks once per
// protected area (Reminders, Automation, …) naming the app that asked.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HttpError } from "../../shared/http.js"
import { HOST_LIMITS } from "../../shared/config.js"

const TIMEOUT = HOST_LIMITS.apple.actionTimeoutMs // ms per action
const MAX_OUTPUT = HOST_LIMITS.apple.outputChars // characters returned

class AppleError extends HttpError {
  constructor(message) {
    super(400, message)
  }
}

const text = (value, name, max = HOST_LIMITS.apple.textChars) => {
  if (typeof value !== "string" || !value.trim()) throw new AppleError(`"${name}" is required.`)
  if (value.length > max) throw new AppleError(`"${name}" is too long (${max} characters max).`)
  return value
}
const optional = (value, name, max) => (value == null || value === "" ? null : text(value, name, max))

// Run a program; resolves with stdout, rejects with its error output.
async function exec(argv, { stdin, timeout = TIMEOUT } = {}) {
  const proc = Bun.spawn(argv, { stdin: stdin != null ? new TextEncoder().encode(stdin) : "ignore", stdout: "pipe", stderr: "pipe", timeout })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (proc.signalCode) throw new AppleError(`${argv[0]} did not finish within ${timeout / 1000}s.`)
  if (code !== 0) throw new AppleError((err || out).trim().split("\n").slice(-3).join(" ") || `${argv[0]} failed (${code}).`)
  return out
}

const clip = (s) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (cut at ${MAX_OUTPUT} characters)` : s)

// AppleScript with the agent's text as arguments (`on run argv`), so text is
// data, never code.
const osascript = (script, args) => exec(["osascript", "-e", script, ...args])

const REMINDERS_ADD = `on run argv
  set theTitle to item 1 of argv
  set theNotes to item 2 of argv
  set theList to item 3 of argv
  tell application "Reminders"
    if theList is "" then
      set target to default list
    else
      set target to list theList
    end if
    set props to {name:theTitle}
    if theNotes is not "" then set props to props & {body:theNotes}
    make new reminder at end of target with properties props
    return "Added to " & (name of target)
  end tell
end run`

const REMINDERS_LIST = `on run argv
  set theList to item 1 of argv
  tell application "Reminders"
    if theList is "" then
      set target to default list
    else
      set target to list theList
    end if
    set out to "List: " & (name of target)
    repeat with r in (reminders of target whose completed is false)
      set out to out & linefeed & "- " & (name of r)
    end repeat
    return out
  end tell
end run`

const NOTIFY = `on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run`

// id -> { tool: the program it needs, run(inputs) -> text }
const ACTIONS = {
  "shortcuts.list": {
    tool: "shortcuts",
    run: async () => {
      const names = (await exec(["shortcuts", "list"])).trim()
      return names ? `Shortcuts on this Mac:\n${names}` : "No shortcuts on this Mac."
    },
  },
  "shortcuts.run": {
    tool: "shortcuts",
    run: async ({ name, input }) => {
      text(name, "name", HOST_LIMITS.apple.shortcutNameChars)
      const dir = await mkdtemp(join(tmpdir(), "askk-shortcut-"))
      try {
        const args = ["shortcuts", "run", name, "--output-path", join(dir, "out")]
        if (optional(input, "input", HOST_LIMITS.apple.shortcutInputChars)) {
          await Bun.write(join(dir, "in.txt"), input)
          args.push("--input-path", join(dir, "in.txt"))
        }
        await exec(args, { timeout: HOST_LIMITS.apple.shortcutTimeoutMs })
        const output = await Bun.file(join(dir, "out")).text().catch(() => "")
        return output.trim() ? `Shortcut "${name}" output:\n${output.trim()}` : `Shortcut "${name}" ran (no output).`
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  say: {
    tool: "say",
    run: async ({ text: words, voice }) => {
      const args = ["say"]
      if (optional(voice, "voice", HOST_LIMITS.apple.voiceChars)) args.push("-v", voice)
      await exec([...args, "-f", "-"], { stdin: text(words, "text", HOST_LIMITS.apple.sayChars), timeout: HOST_LIMITS.apple.sayTimeoutMs })
      return "Spoken aloud."
    },
  },
  notify: {
    tool: "osascript",
    run: async ({ title = "ASKK", message }) => {
      await osascript(NOTIFY, [optional(title, "title", HOST_LIMITS.apple.titleChars) ?? "ASKK", text(message, "message", HOST_LIMITS.apple.messageChars)])
      return "Notification shown."
    },
  },
  "clipboard.read": {
    tool: "pbpaste",
    run: async () => {
      const value = await exec(["pbpaste"])
      return value ? `Clipboard:\n${value}` : "The clipboard has no text."
    },
  },
  "clipboard.write": {
    tool: "pbcopy",
    run: async ({ text: value }) => {
      await exec(["pbcopy"], { stdin: text(value, "text", HOST_LIMITS.apple.clipboardChars) })
      return `Copied ${value.length} characters to the clipboard.`
    },
  },
  "spotlight.search": {
    tool: "mdfind",
    run: async ({ query, limit = HOST_LIMITS.apple.spotlightResults }) => {
      const n = Math.min(Math.max(Number(limit) || HOST_LIMITS.apple.spotlightResults, 1), HOST_LIMITS.apple.spotlightResultsMax)
      const paths = (await exec(["mdfind", text(query, "query", HOST_LIMITS.apple.queryChars)])).split("\n").filter(Boolean)
      if (!paths.length) return `Spotlight found nothing for "${query}".`
      const more = paths.length > n ? `\n… and ${paths.length - n} more` : ""
      return `Spotlight, "${query}" (${paths.length}):\n${paths.slice(0, n).join("\n")}${more}`
    },
  },
  "reminders.list": {
    tool: "osascript",
    run: async ({ list }) => osascript(REMINDERS_LIST, [optional(list, "list", HOST_LIMITS.apple.titleChars) ?? ""]),
  },
  "reminders.add": {
    tool: "osascript",
    run: async ({ title, notes, list }) =>
      osascript(REMINDERS_ADD, [text(title, "title", HOST_LIMITS.apple.reminderTitleChars), optional(notes, "notes", HOST_LIMITS.apple.notesChars) ?? "", optional(list, "list", HOST_LIMITS.apple.titleChars) ?? ""]),
  },
  open: {
    tool: "open",
    run: async ({ url }) => {
      let parsed
      try {
        parsed = new URL(text(url, "url", HOST_LIMITS.apple.urlChars))
      } catch {
        throw new AppleError("Not a valid URL.")
      }
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) throw new AppleError("Only http, https and mailto links can be opened.")
      await exec(["open", parsed.href])
      return `Opened ${parsed.href}.`
    },
  },
}

export const APPLE_ACTIONS = Object.keys(ACTIONS)

export async function createApple() {
  if (process.platform !== "darwin") return null
  const actions = APPLE_ACTIONS.map((id) => ({ id, available: !!Bun.which(ACTIONS[id].tool) }))
  const available = new Set(actions.filter((a) => a.available).map((a) => a.id))
  return {
    actions,
    async run(id, inputs = {}) {
      if (!ACTIONS[id]) throw new AppleError(`Unknown Apple action "${id}".`)
      if (!available.has(id)) throw new AppleError(`${ACTIONS[id].tool} is not available on this Mac.`)
      return { text: clip(String(await ACTIONS[id].run(inputs ?? {})).trim()) }
    },
  }
}
