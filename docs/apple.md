# Apple capabilities: inventory and integration plan

What ASKK can use when it runs on Apple devices, and how. Researched October
2026 against macOS 27.2 (build 26B5091g) on the owner's Mac. Items marked
**verified** were confirmed on that machine; the rest come from Apple
documentation (sources at the end).

There are three layers, and each is reached differently:

| Layer | Where | How ASKK reaches it | Devices |
|---|---|---|---|
| A. Safari / WebKit | any page | browser APIs, already client-side | Mac, iPhone, iPad, Vision Pro |
| B. macOS command-line tools | local mode | host API runs the tool (`/__askk/…`) | Mac only |
| C. macOS frameworks | local mode | a small Swift helper the host API calls | Mac only |

On iPhone and iPad, ASKK is only ever a web page, so layer A is all there
is. Layers B and C need the local host (`bun run dev` / `askk`) on a Mac.

## Built: `apple.*` tools (layer B)

The owner's Mac is reachable as tools, each call authorized by the owner.
The agent proposes a request; the approval card says in plain words what it
will do ("Add the reminder “Call Sam” to “Work”.") with the exact inputs
below; nothing runs until the owner approves.

| Tool | What it does | Approval |
|---|---|---|
| `apple.shortcuts.list` | names of the owner's Shortcuts | no |
| `apple.shortcuts.run` | run a shortcut by name, text in, text out | yes |
| `apple.say` | speak aloud with an Apple voice | no |
| `apple.notify` | macOS notification | no |
| `apple.clipboard.read` / `.write` | the clipboard | yes |
| `apple.spotlight.search` | search the whole Mac | yes |
| `apple.reminders.list` / `.add` | Reminders | yes |
| `apple.open` | open an http(s) or mailto link | yes |

How: `backend/features/apple/tools.js` (specs, `describe`) →
`POST /__askk/apple/run` → `companion/apple.js` runs a fixed program
(`shortcuts`, `say`, `osascript`, `pbcopy`/`pbpaste`, `mdfind`, `open`) with
an argument list, never a shell; AppleScript gets the agent's text as
`argv`, so text is data, not code. Timeout 60 s (shortcuts 5 min), output
capped. Capability `apple` (macOS only) is listed in the header. The lead
has these tools; add them to any agent.md under `tools:`.

Authorization is two-fold: the ASKK approval card per call, and macOS's own
permission prompt the first time an area is used (Reminders, Automation),
naming the app that runs ASKK (the terminal for `bun run dev`).

## B0. The headline: Apple's on-device model as an ASKK model (verified)

macOS 27 ships `/usr/bin/fm`, the Foundation Models CLI (WWDC26 session 334):

- `fm respond`: one prompt, with `--model system|pcc`, `--image`,
  `--schema` (JSON Schema for structured output) and `--instructions`.
- `fm chat`: an interactive chat.
- `fm schema`: builds JSON Schemas.
- `fm serve` (present in the 27.2 binary; not in the WWDC session) runs a
  local, OpenAI-compatible server:
  - `GET /v1/models` and `POST /v1/chat/completions`, streaming (SSE) and
    non-streaming;
  - `--host` / `--port` (TCP) or `--socket` (Unix socket);
  - sends CORS headers (`Access-Control-Allow-*`), so a browser page can
    call it directly;
  - accepts OpenAI tool calls (`role: "tool"` with `tool_call_id`);
  - models: `system` (on-device Apple Foundation Model), `pcc` (larger,
    Private Cloud Compute, usage-limited), or an upstream
    `--model-provider` it routes to;
  - built-in tools `ocr` and `barcode` (Vision) for image prompts.

**Status on this Mac:** installed, but locked until the owner accepts the
terms: `sudo fm license` (machine-wide; the owner must do this).

**For ASKK:** this needs no new code. It is an `openai` provider entry:

```
ASKK_MODEL_BASE_URL=http://127.0.0.1:<port>/v1
ASKK_MODEL_ID=system           # or pcc
```

Next steps: the host could start `fm serve` itself when the licence is
accepted (capability `models.apple`), and the catalogue could list `system`
and `pcc` automatically. This gives free, private, offline agents with no
setup. The on-device model is small (around 3B parameters), so it suits the
searcher and humaniser or short tasks. The lead may want `pcc` or a bigger
model.

## A. Safari / WebKit: every Apple device

| Capability | API | ASKK use | Notes |
|---|---|---|---|
| Dictation (Apple speech) | `webkitSpeechRecognition` | **in use**: chat mic (`lib/speech.js`) | Safari and every iOS browser; secure context |
| Spoken answers (Apple voices) | `speechSynthesis` | read answers aloud; hands-free loop with dictation | no permission needed |
| Share | `navigator.share` | share an answer or file to Messages, Mail, Notes, AirDrop | needs a user gesture |
| Notifications | `Notification` (+ Web Push on Home Screen apps, iOS 16.4+) | "quest finished" or "approval needed" while in another tab | Push needs a push server, which is out of scope; local notifications work while the page is open |
| App badge | `navigator.setAppBadge` | count of pending approvals on the Home Screen icon | installed web app only |
| Keep awake | Screen Wake Lock | keep the screen on during long runs | |
| Passkeys | WebAuthn | (future) unlock stored API keys | |
| GPU compute | WebGPU (Safari 26) | (future) run small models in the browser | |
| Media | WebCodecs audio/video (26) | (future) video artifact | |
| 3D | `<model>` element (26) | (future) 3D artifact | visionOS / iOS |
| Identity documents | Digital Credentials API (26) | not relevant | Wallet IDs |
| Files | OPFS | **in use**: browser workspace and memory | |

## B. macOS command-line tools: host API (verified present)

Each becomes a host capability and a tool. Side effects need the owner's
approval, as `fs.write` does today.

| Tool | Command | ASKK tool idea | Approval |
|---|---|---|---|
| Shortcuts (11 on this Mac) | `shortcuts list / run <name> -i -o` | `apple.shortcut.run`: reaches every app's App Intents and the Apple Intelligence actions in Shortcuts | yes |
| Speak | `say -v <voice>` (189 voices) | `apple.say` | no |
| Spotlight | `mdfind`, `mdls` | `apple.spotlight.search` over the whole Mac | no (read) |
| Clipboard | `pbcopy` / `pbpaste` | `apple.clipboard.read/write` | write: yes |
| Notify | `osascript -e 'display notification …'` | `apple.notify` | no |
| Screenshot | `screencapture -x` | `apple.screen.capture`, then `fm --image` or OCR | yes (privacy) |
| Images | `sips` | resize, convert, crop | write: yes |
| Documents | `textutil` | convert docx, rtf, html to text for agents | no |
| Apps | `osascript` (AppleScript/JXA) | Notes, Reminders, Calendar, Mail, Messages, Music, Finder | yes; macOS asks per app (Automation permission) |
| Keychain | `security find/add-generic-password` | keep API keys in the Keychain instead of `.env` | yes |
| Apple model | `fm respond --schema` | structured extraction, one shot | no |

## C. macOS frameworks: a Swift helper (verified present)

All of these frameworks are present on this Mac, and `swiftc` and Xcode are
installed. Bun cannot call Swift directly. A small helper (`askk-apple`,
built by `bun run build:apple`) would take JSON on stdin and return JSON on
stdout, and the host API would run it per request.

| Framework | Capability | ASKK use |
|---|---|---|
| FoundationModels | on-device model with guided generation and tools, image input, dynamic profiles | richer than `fm serve`: schemas as Swift types |
| Speech (SpeechAnalyzer, macOS 26+) | fast on-device transcription of long audio | transcribe recordings and meetings into the workspace |
| Vision / VisionKit | OCR, barcodes, image analysis | read screenshots, PDFs and photos |
| Translation | on-device translation | `apple.translate` |
| NaturalLanguage | language ID, tagging, embeddings | cheap local embeddings to search the workspace |
| EventKit | Calendar and Reminders | `apple.calendar.*`, `apple.reminders.*`, with structured results |
| Contacts | address book | look up people |
| CoreLocation / MapKit | location, places, directions | "near me" tasks |
| WeatherKit | weather | needs an Apple developer entitlement |
| Photos | the photo library | find and describe photos |
| ImagePlayground | image generation (Private Cloud Compute) | an image artifact |
| Core AI / Core ML | run other models on the Neural Engine | local models besides Apple's |
| UserNotifications | rich notifications with actions | approve from the notification |
| LocalAuthentication | Touch ID | confirm risky approvals with a fingerprint |

Most of these trigger macOS privacy prompts (Calendar, Contacts, Photos,
Location, Microphone, Screen Recording). The first prompt names the app that
asked: the helper, or the terminal it runs from.

## How it fits ASKK

- **A capability per layer item.** The host advertises what this Mac has in
  `whoami` (e.g. `apple.model`, `apple.shortcuts`, `apple.speech`).
  `HOST_CAPABILITIES` shows it in the header, with the browser fallback.
- **A feature folder.** `backend/features/apple/` holds the tool specs; the
  host API does the work. Agents list tools such as `apple.shortcut.run`.
- **Owner in control.** Side effects go through approval cards. Nothing
  reads the Calendar, Contacts or screen unless the owner has approved that
  agent's call and macOS's own prompt.
- **Same code in every mode.** On iPhone, iPad or a hosted site, these
  capabilities are listed as missing, as `fs.*` is today.

## Suggested order

1. **Apple model via `fm serve`** (no code; then auto-start in the host).
2. **Spoken answers** (`speechSynthesis`), alongside the existing dictation.
3. **Shortcuts** (`shortcuts run`): one tool that reaches every app with
   App Intents.
4. **Notifications and badge** for approvals and finished quests.
5. **Swift helper**: transcription, OCR, Translation, EventKit.

## Sources

- [Apple: Foundation Models framework (newsroom, Sept 2025)](https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/)
- [Apple: new intelligence frameworks and tools (newsroom, June 2026)](https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/)
- [WWDC26: Build AI-powered scripts with the fm CLI and Python SDK](https://developer.apple.com/videos/play/wwdc2026/334/)
- [WWDC26: Bring an LLM provider to the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/339/)
- [WWDC26 Apple Intelligence guide](https://developer.apple.com/wwdc26/guides/apple-intelligence/)
- [ChatForest: fm serve not in Apple's docs (June 2026)](https://chatforest.com/builders-log/apple-fm-cli-python-sdk-fm-serve-openai-compatible-psotu-wwdc-2026/)
- [WebKit features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/)
- [Apple Support: Run shortcuts from the command line](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac)
- [MacStories: SpeechAnalyzer vs Whisper](https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/)
