// The apple.* tools: Apple's macOS APIs on the owner's Mac — Shortcuts,
// speech, notifications, clipboard, Spotlight, Reminders, opening links.
// The host API runs them (companion/apple.js, capability `apple`); in the
// browser-only build, or off a Mac, they report that they are unavailable.
//
// Authorized by the owner: every call that reads personal data or acts
// outside ASKK needs approval, and its card says in plain words what the
// call will do (`describe`). macOS adds its own prompt the first time an
// area is used (Reminders, Automation, …).

import { clip } from "@/backend/core/util/text"
import { hostRequest } from "@/backend/platform/host-fetch"
import { detectHost, hasCapability } from "@/backend/platform/host"
import { LIMITS } from "@/lib/config"

async function runAction(action, inputs) {
  const host = await detectHost()
  if (!hasCapability(host, "apple")) {
    throw new Error("Apple capabilities need ASKK running locally on a Mac (bun run dev or askk); they are not available here.")
  }
  const data = await hostRequest("apple/run", { body: { action, inputs }, label: "Apple" })
  return data.text
}

// The CONTEXT line for the apple.* tools.
async function describeApple() {
  const host = await detectHost()
  return hasCapability(host, "apple")
    ? "Apple: ASKK runs on the owner's Mac; apple.* tools use its apps and services. Calls that act or read personal data wait for the owner's approval."
    : "Apple: not available here (needs ASKK running locally on a Mac); apple.* calls will fail."
}

const str = (maxLength) => ({ type: "string", minLength: 1, maxLength })
const quote = (s = "", n = LIMITS.apple.quoteChars) => `“${clip(s, n)}”`

const SPECS = {
  "apple.shortcuts.list": {
    description: "List the owner's Shortcuts on this Mac (names). Use before apple.shortcuts.run.",
    inputs: { type: "object", properties: {}, additionalProperties: false },
  },
  "apple.shortcuts.run": {
    view: "text",
    description:
      "Run one of the owner's Shortcuts by exact name, optionally with text input; returns its text output. " +
      "Shortcuts reach the owner's apps and Apple Intelligence actions. Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { name: str(LIMITS.apple.shortcutNameChars), input: { type: "string", maxLength: LIMITS.apple.shortcutInputChars } },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    describe: ({ name, input }) => `Run the shortcut ${quote(name)}${input ? ` with the input ${quote(input)}` : ""}.`,
  },
  "apple.say": {
    description: "Speak text aloud on the Mac with an Apple voice (optional voice name, e.g. Samantha).",
    inputs: {
      type: "object",
      properties: { text: str(LIMITS.apple.sayTextChars), voice: { type: "string", maxLength: LIMITS.apple.voiceNameChars } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  "apple.notify": {
    description: "Show a macOS notification to the owner.",
    inputs: {
      type: "object",
      properties: { title: { type: "string", maxLength: LIMITS.apple.notifyTitleChars }, message: str(LIMITS.apple.notifyMessageChars) },
      required: ["message"],
      additionalProperties: false,
    },
  },
  "apple.clipboard.read": {
    view: "text",
    description: "Read the text on the owner's clipboard. Needs the owner's approval.",
    inputs: { type: "object", properties: {}, additionalProperties: false },
    approval: true,
    describe: () => "Read the text on your clipboard.",
  },
  "apple.clipboard.write": {
    view: "text",
    description: "Put text on the owner's clipboard (replaces what is there). Needs the owner's approval.",
    inputs: { type: "object", properties: { text: str(LIMITS.apple.clipboardChars) }, required: ["text"], additionalProperties: false },
    effect: "write",
    approval: true,
    describe: ({ text = "" }) => `Replace your clipboard with ${text.length} characters: ${quote(text)}.`,
  },
  "apple.spotlight.search": {
    view: "text",
    description:
      "Search the whole Mac with Spotlight (file names and contents; Spotlight query syntax works). " +
      "Returns paths, outside the workspace too. Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { query: str(LIMITS.apple.spotlightQueryChars), limit: { type: "integer", minimum: 1, maximum: LIMITS.apple.spotlightMaxResults } },
      required: ["query"],
      additionalProperties: false,
    },
    approval: true,
    describe: ({ query }) => `Search your whole Mac with Spotlight for ${quote(query)}.`,
  },
  "apple.reminders.list": {
    view: "checklist",
    description: "List open reminders in a Reminders list (default list when omitted). Needs the owner's approval.",
    inputs: { type: "object", properties: { list: { type: "string", maxLength: LIMITS.apple.reminderListChars } }, additionalProperties: false },
    approval: true,
    describe: ({ list }) => `Read your open reminders in ${list ? quote(list) : "your default list"}.`,
  },
  "apple.reminders.add": {
    view: "checklist",
    description: "Add a reminder (title, optional notes and list name). Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { title: str(LIMITS.apple.reminderTitleChars), notes: { type: "string", maxLength: LIMITS.apple.reminderNotesChars }, list: { type: "string", maxLength: LIMITS.apple.reminderListChars } },
      required: ["title"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    describe: ({ title, list }) => `Add the reminder ${quote(title)} to ${list ? quote(list) : "your default list"}.`,
  },
  "apple.open": {
    description: "Open an http(s) or mailto link on the Mac (default browser or mail app). Needs the owner's approval.",
    inputs: { type: "object", properties: { url: str(LIMITS.apple.urlChars) }, required: ["url"], additionalProperties: false },
    effect: "write",
    approval: true,
    describe: ({ url }) => `Open ${url} on your Mac.`,
  },
}

// Tool specs by name (registered in features/index.js); apple.x.y runs host action x.y.
export const APPLE_TOOLS = Object.fromEntries(
  Object.entries(SPECS).map(([name, spec]) => [
    name,
    { ...spec, context: describeApple, run: (inputs) => runAction(name.slice("apple.".length), inputs) },
  ])
)
