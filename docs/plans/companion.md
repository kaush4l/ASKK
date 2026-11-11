# Plan: the companion

A small character that lives on the desktop outside the main window, shows what the engines are
doing, and opens into a chat bubble. The starter is one hardcoded companion; later the look
becomes a "companion pack" (an asset plus a checked manifest, never code).

Written 2026-11-09. No product code was changed. Everything marked **[spike]** was run on this
Mac (M4 Max, macOS 27.2, Xcode 27.2, dx 0.7.10, tao 0.34.8, wry 0.53.5) in a throwaway crate
outside the repo. **[source]** means read in the locked crate sources or the `dx` binary.
**[web]** means read on the web today (links at the end). **[memory]** means I know it but did
not re-check it today. Choices marked **(mine)** are my proposals, not the owner's decisions.

## The short answer

1. **Stage**: a clear, borderless, above-everything window made with the same tao/wry calls
   `shells/mac/notch.rs` already uses. Click-through, never-takes-focus and "above the menu bar"
   all work with the locked versions **[spike]**.
2. **Drawing**: web drawing inside that window, because the Mac app, the iPhone app and the
   browser are all a WebKit page: one drawing plays on all three. The starter is an inline SVG
   moved by CSS keyframes (no asset, about 0.5% of one core while it moves, 0% when still). The
   pack format later is a sprite sheet played with CSS `steps()`.
3. **iPhone**: there is no system-wide overlay on iOS. The same component is an in-app bubble
   there. `dx build --ios` already builds this tree and it launches in the simulator **[spike]**,
   but it shows a blank screen until a phone shell sets the host address.

## (a) Animation options

Two separate questions: what holds the character (the stage) and what draws it.

### The stage: one window, proven

| need | how | status |
| --- | --- | --- |
| clear, no frame, no shadow | `with_transparent(true)`, `with_decorations(false)`, `with_has_shadow(false)`, `Config::with_background_color((0,0,0,0))` | already used by `notch.rs`; `isOpaque=false` **[spike]** |
| above other windows, on every Space | `with_always_on_top(true)`, `with_visible_on_all_workspaces(true)` | used by `notch.rs` |
| above the menu bar (to touch the notch) | `setLevel: 25` through objc2 | `level=25` read back **[spike]** |
| clicks pass through | `window.set_ignore_cursor_events(true)` (tao → `setIgnoresMouseEvents:`) | `ignoresMouseEvents=true` read back **[spike]**. tao applies it on the main queue, so it is true a moment later, not at once **[source]** |
| never steals typing focus | `with_focusable(false)` (tao's window class then answers `canBecomeKeyWindow = NO`) | `canBecomeKeyWindow=false`, `isKeyWindow=false` **[spike]**. Without it the page did take focus in 2 of 5 runs even with `with_focused(false)` |
| animation keeps running while unfocused and click-through | nothing to do | CSS and `requestAnimationFrame` both kept running, `visibilityState=visible` **[spike]** |
| per-pixel hit testing | not offered by tao/wry. Two ways: keep the window as small as the character (clicks land only on it), or poll `NSEvent.mouseLocation` and flip click-through when the pointer is over the character | pointer read needs no permission **[spike]**; a 30 Hz poll cost about 1% of a core, so poll at 10 Hz or only while the pointer is near |
| a true `NSPanel` (non-activating) | swap the window's class through objc2, as Tauri's panel plugins do **[memory]** | not needed for the starter; listed so it is known |

The spike did not send a synthetic click (no full-screen control was used), so "the click really
reaches the app underneath" rests on AppKit's documented meaning of `ignoresMouseEvents`, not on
a click I made.

### The drawing: comparison

CPU is percent of one core, summed over the app and its two WebKit helper processes, 160×160
window, debug build, one run each **[spike]**. The cost inside WindowServer was not measured.

| option | how it looks | CPU while it plays | asset and licence | same asset on iPhone and web | verdict |
| --- | --- | --- | --- | --- | --- |
| inline SVG + CSS keyframes (transform, opacity) | flat vector, takes theme colours | **0.5%** (0% when still) | none: drawn in code | yes | **starter (mine)** |
| sprite sheet + CSS `steps()` | any drawn art, pixel art | **2.3–3.1%** at 10 frames a second | one PNG/WebP + a small JSON; art licence is per pack. An open format with a gallery exists (Petdex / "Codex pets": 8×9 grid of 192×208 frames; code MIT, each pet under its submitter's licence) **[web]** | yes | **the pack format (mine)** |
| Canvas 2D / WebGL driven by `requestAnimationFrame` | anything | **about 17%** for a trivial 60-per-second loop | n/a | yes | only for short bursts; never as the idle loop |
| Lottie (lottie-web, dotLottie) | smooth After-Effects style vector | not measured; it is a frame loop, so expect the canvas class of cost while playing | `.json` / `.lottie`; players are open source (dotLottie listed as MIT, not checked at the repo); dotLottie's engine is about 500 KB compressed and has state machines **[web]** | yes (web player in the webview) | workable second pack kind; adds a runtime for no gain over sprites today |
| Rive | the best: rigged characters with a state machine and inputs (moods as inputs, eyes following the pointer) | not measured; a canvas frame loop while playing | `.riv`; runtimes MIT; web runtime 707 KB (lite, 222 KB compressed) to 2.2 MB; the editor is a hosted product: free exports carry a Rive splash screen, $9 per seat per month removes it **[web]** | yes (web runtime) | a later pack kind if the owner wants rigs; not the starter (paid editor, runtime, frame loop) |
| Live2D Cubism | anime-style 2D rigs | WebGL frame loop | proprietary SDK; releasing needs a publication licence agreement, and apps that load models chosen by the user ("expandable applications") are outside the standard one **[web]** | yes technically | **no**: the licence collides with the pack idea |
| Spine | skeletal game animation | frame loop | whoever ships the runtime must hold a Spine editor licence; revenue ceiling **[web]** | yes technically | **no** for now |
| native Core Animation / SpriteKit / Metal through objc2 | anything, cheapest, true per-pixel | lowest | n/a | **no**: Mac only; iPhone would need a second renderer, web has none | **no** as the renderer: it breaks "one codebase". objc2 stays for window traits only, as in `notch.rs` |

**Recommendation (mine): the tao/wry stage, an SVG + CSS starter, sprite-sheet packs later.**
Reason: it is the only row that needs no new dependency, no asset licence and no second renderer,
it is the cheapest thing measured, and it already matches how the notch face is built. Rive is
the upgrade path if the character should feel alive beyond a few loops; it fits the same seam
(a pack with a different `kind`, a new player in code).

### The sandbox

`sandbox-exec` wraps the **host** only (`scripts/sandboxed.sh` runs the server binary under
`sandbox/server.sb`). The Mac app is started outside it, so the companion window is not affected
by the profile. The starter asks the host for nothing new (`api::glance`, `api::changes`,
`api::surfaces` exist). Packs later live in the data folder, which the profile already lets the
host read and write, so no profile change. One rule to keep: a runtime such as Rive must be
bundled as an asset, never fetched from a CDN by the page.

### Different things it could do

| behaviour | how | cost and risk |
| --- | --- | --- |
| sit in a corner | fixed window position from the screen size | none; the starter |
| peek from a screen edge | slide the character inside its window, or move the window partly off-screen (borderless windows are not held on-screen by AppKit **[memory]**) | cheap; not spiked |
| hang from the notch | notch area from `NSScreen.safeAreaInsets` / `auxiliaryTopLeftArea` (macOS 12+) **[memory]**, window at level 25 | cheap; the notch face already sits there, so decide which of the two owns the notch |
| sit on the Dock | Dock height = screen frame minus visible frame; there is no public API for where each Dock icon is **[memory]** | cheap; it can sit on the Dock's edge, not on a chosen icon |
| look at the pointer | `NSEvent.mouseLocation` at 10 Hz | measured about 1% at 30 Hz; no permission |
| walk on other apps' windows | window bounds from `CGWindowListCopyWindowInfo` | bounds come back without Screen Recording permission today, but Apple documents no promise about which fields do, and a forum thread reports it changing between releases **[web]**. Fragile; last |
| speech bubble with the newest message | text beside the character | shows message content on the desktop and in screen shares: an owner decision (question 5) |
| drag to move | tao `drag_window()`; the place is kept in the page's local storage, since a shell may not touch the disk | cheap |

## (b) The chat bubble

One design, two containers.

**The parts (shared, in `ui`)**: `CompanionView` (the character, its mood) and `BubbleView` (a
compact chat: the log and an input, using `api::engine_chat` and `api::post_message` as
`ChatView` does). Clicking the character opens the bubble.

**Mac**: two OS windows owned by one face file.

- The character window: about 96×96, clear, on every Space, never focusable, so it cannot
  interrupt typing. It is exactly the size of the character, so no click-through is needed yet.
- The bubble window: made on the first click, placed beside the character, focusable (it must
  take the keyboard), closed by Esc or a second click on the character. It is the notch pattern:
  `window().new_window(dom, cfg)` with a bare root.
- The character tells the shell "I was clicked" through a context the face provides (the way
  `Bare` is provided today), because `ui` may not call `shells`.
- (mine) The bubble does not close when it loses focus: copying text from another app into the
  chat must work.

**iPhone and iPad**: what the system allows.

| idea | allowed | what it takes |
| --- | --- | --- |
| a bubble floating over other apps | **no**. iOS has no "draw over other apps" **[memory]**; my search found no API or exception | — |
| a floating bubble inside our app | **yes** | the same `CompanionView`, `position: fixed` in a corner of the shell, opening `BubbleView` as a sheet. No native code |
| Live Activity / Dynamic Island (running and waiting counts on the Lock Screen and island) | **yes, with Swift** | ActivityKit + a widget extension written in SwiftUI. dx 0.7.10 has a `[[ios.widget_extensions]]` setting that compiles a Swift extension into the app **[source: the dx binary]**; not tried. Active for up to 8 hours; drawn by the system from a fixed layout, not our animation; updating it while the app is in the background needs push notifications **[web]**, which need the paid Apple programme |
| Home / Lock Screen widget | **yes, with Swift** | WidgetKit; refreshed on a system budget, not live **[memory]** |
| Picture in Picture as a floating companion | **not a real option** | the API is for video; starting it without a user action gets apps rejected; whether non-video content passes review is unanswered **[web]** |
| notifications ("an engine is waiting for you") | **yes** | local ones while the app runs; when it is closed the host must send through Apple's push service (paid programme, a key on the host) |
| iPad | same as iPhone | Split View / Stage Manager let the user keep the app beside another one; that is the user's doing, not an overlay |

**What this means for one design**: the character and the bubble are one pair of components and
one value. The Mac shell gives them OS windows; the phone and web shells draw them inside the
page. "Lives outside the app" is a Mac ability only. On the phone the nearest thing is a Live
Activity, which is a separate, Swift, system-drawn surface showing the same two numbers, and it
comes last.

## (c) Building for iPhone and Mac

### What is true today

- `mobile` in Dioxus 0.7.10 is `dioxus-desktop` compiled for iOS: tao + wry's WKWebView
  **[source]**. So the phone app is the same kind of thing as the Mac app.
- Desktop-only pieces are already gated: `shells::mac` is behind
  `cfg(all(feature = "desktop", target_os = "macos"))`, `objc2` is only in the `desktop` feature,
  and tray/menu/hotkey crates are target-gated inside `dioxus-desktop` itself **[source]**.
- `cargo check --locked --no-default-features --features mobile --target aarch64-apple-ios-sim`
  on the current tree: **passes** **[spike]** (target dir outside the repo).
- `dx build --ios` on a copy of the current tree: **passes in 32 s**, makes
  `target/dx/askk/debug/ios/Askk.app` (arm64, bundle id `com.example.Askk`) **[spike]**.
- Installed and launched in the iPhone 17 Pro simulator: the process runs, the screen is
  **blank white** **[spike]**. No host was running and no host address is set on this path (see
  blocker 1), so every page waits for ever behind an empty fallback. I did not prove the cause
  from the log.
- Docs: `dx serve --ios` runs in the simulator; signing is needed for a real device and the
  store; Dioxus has no signing guide of its own and points to Tauri's **[web]**.

### Commands

```sh
# once (both targets are already installed on this Mac)
rustup target add aarch64-apple-ios aarch64-apple-ios-sim

# simulator: build, install, launch, look
dx build --ios
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl install booted target/dx/askk/debug/ios/Askk.app
xcrun simctl launch booted com.example.Askk
xcrun simctl io booted screenshot /tmp/askk-ios.png

# simulator with hot reload (not tried here: it also builds and runs its own server)
dx serve --ios

# a real iPhone (not tried: this Mac has no signing identity)
dx serve --ios --device "<phone name>" --codesign \
  --apple-team-id "<Signing Name (TEAMID)>" --apple-entitlements ios/entitlements.plist
dx bundle --ios --release

# Mac, as today
dx build --platform macos
ASKK_HOST=http://127.0.0.1:8090 target/dx/askk/debug/macos/Askk.app/Contents/MacOS/askk
```

### Blockers found, in the order they bite

1. **No phone shell.** On a `mobile` build `shells::launch()` falls through to `web::launch()`,
   which never calls `dioxus::fullstack::set_server_url`. The default is an empty origin
   **[source]**, so no server function can reach a host. Needs `shells/phone.rs`.
2. **The host address comes from the environment.** `core/places.rs` reads `ASKK_HOST`; an iPhone
   app is not started with the user's environment. (mine) Bake a default at build time
   (`option_env!("ASKK_HOST")`, still inside `places.rs` so the wall test holds), later a field
   on a first-run screen kept in the page's local storage.
3. **The host listens on this Mac only.** `scripts/sandboxed.sh` sets `IP=127.0.0.1` and the
   profile allows binding `localhost:PORT` only. The simulator shares the Mac's loopback
   **[memory]**, so it works there. A real phone cannot reach it, and the API has no login (none
   found in `src/api`). This is an owner decision (question 3).
4. **No signing identity.** `security find-identity -p codesigning` shows 0 valid identities, so
   nothing can be put on a real phone yet. A free Apple ID allows 7-day installs on your own
   phone **[memory]**; push, TestFlight and Live Activity updates need the paid programme.
5. **Bundle id is `com.example.Askk`.** `Dioxus.toml` has no `[bundle] identifier`. It must be
   set before signing.
6. **A phone on Wi-Fi needs the Local Network permission** (an Info.plist usage text). dx 0.7.10
   has `[ios.plist]` and a `local-network` permission setting **[source: the dx binary]**; the
   exact spelling in `Dioxus.toml` is not verified.
7. **App Store packaging is not finished upstream.** A pull request to make
   `dx bundle --platform ios --release` produce an accepted `.ipa` is still open and aimed at
   0.8 **[web]**. This does not block running on your own phone.
8. Cosmetic: `dx doctor` prints "Simulator: not found" although simulators exist and worked.

## (d) Where it lives

```
src/core/companion.rs            new   Mood, the rule from numbers to mood; later the pack contract
src/core/surfaces.rs             edit  the `companion` value and its checks
defaults/surfaces.json           edit  the starter value
src/ui/components/companion.rs   new   the drawing: one inline SVG, a class per mood
assets/styling/glass.css         edit  the keyframes, and `prefers-reduced-motion`
src/ui/views/companion.rs        new   CompanionView: glance → mood → drawing; click → bubble
src/ui/views/bubble.rs           new   BubbleView: compact chat
src/ui/views/shell.rs            edit  phone and web: draw the pair inside the page
src/shells/mac/companion.rs      new   the face: character window + bubble window
src/shells/mac/mod.rs            edit  call `companion::use_companion`
src/structure.rs                 edit  add `companion.rs` to the list of Mac faces
src/shells/phone.rs              new   the phone shell: set the host, launch
src/shells/mod.rs                edit  pick the phone shell on `mobile`
```

Nothing new under `host/` or `api/` for the starter.

(mine) The face draws `CompanionView` and `BubbleView` directly, not through a page, although the
notch shows a page. Reason: seeding copies only missing top-level entries (a known limit in
`structure.md`), so a new default page under `routes/` would not appear in a data folder that
already exists, and the companion would open on "no page". A `page` field for the bubble can be
added later as one more value.

### The starter value

```json
"companion": {"on": true, "place": "bottom-right", "size": 96, "engine": "askk",
              "bubble": {"width": 380, "height": 520}}
```

| field | meaning | check when read |
| --- | --- | --- |
| `on` | whether the companion is drawn | bool |
| `place` | `bottom-right`, `bottom-left`, `top-right`, `top-left` | unknown word refused |
| `size` | the character's edge in points | 48..=256 |
| `engine` | the engine the bubble talks to | a path: no empty, `.` or `..` segment |
| `bubble.width`, `bubble.height` | the chat panel | 280..=640, 320..=900 |

As with every face: unknown field refused, missing field takes the default, and the shipped
`defaults/surfaces.json` must equal `Surfaces::default()` (the existing test).

### Moods come from what the app already knows

Fixed in code, in `core/companion.rs`, a plain function with tests:

| mood | when | source today |
| --- | --- | --- |
| `asleep` | the host does not answer | `glance()` returns an error |
| `asking` | `waiting > 0` (an engine has left you a message) | `Glance.waiting` |
| `working` | `running > 0` and nothing waiting | `Glance.running` |
| `idle` | both zero | `Glance` |

Plus two one-shot beats from the change between two glances: `arrived` (waiting went up) and
`done` (running fell to zero with nothing waiting). `asking` wins over `working` (mine): a
question for you matters more than work in progress. A `failed` mood needs one more number in
`Glance` (engines whose status is `error`); that is a later step in `api/surfaces.rs`.

The numbers arrive the way `GlanceView` gets them (`use_live_server(String::new, glance)`), so
the character redraws only when the host marks a change. The face's root must call
`use_live_provider()` since it has no shell layout above it.

## (e) The plugin seam, later

A companion pack is **an asset and a checked value**. It is never code, markup or style text.

**Fixed in code**: the moods and beats and the rule that picks them; the stage (window traits,
places, the bubble); the players (today one: the sprite player); every check below.

**A value**: which pack (`"companion": {"pack": "mochi"}`; absent means the built-in one); and
inside the pack, which frames each mood plays and how fast.

A pack is a folder in the data store, under a new manifest key (`"companions": "companions"` in
`askk.json`):

```
companions/mochi/companion.json
companions/mochi/sheet.webp
```

```json
{"name": "Mochi", "kind": "sprite", "sheet": "sheet.webp",
 "frame": [192, 208], "grid": [8, 9],
 "moods": {"idle":    {"row": 0, "frames": 6, "fps": 6},
           "working": {"row": 7, "frames": 8, "fps": 10},
           "asking":  {"row": 6, "frames": 6, "fps": 8}},
 "beats": {"arrived": {"row": 3, "frames": 4, "fps": 8},
           "done":    {"row": 4, "frames": 5, "fps": 10}},
 "author": "…", "licence": "CC0-1.0"}
```

Checked when read, each failure an error with its reason and a fall back to the built-in one:

- unknown field, mood or beat: refused. `idle` is required; a missing mood plays `idle`.
- `row` inside the grid, `frames` no more than the columns, `fps` 1..=24, frame edge 16..=512.
- the sheet: `.webp` or `.png` by its first bytes, not by its name; at most 4 MB; its pixel size
  equals frame × grid. No other file in the folder is ever read.
- the pack name is one path segment.
- the player builds the animation from these numbers; nothing from the pack is put into the
  page as text.

The sheet reaches the window through one new server function (`api::companion_sheet(name)`),
because the Mac app and the phone cannot read the host's files.

(mine) Make the sprite layout able to hold the Petdex / "Codex pets" sheet (8×9 grid of 192×208;
rows idle, running-right, running-left, waving, jumping, failed, waiting, running, review
**[web]**), and add a small importer that turns such a pet into our manifest (`running` →
`working`, `waiting` → `asking`, `waving` → `arrived`, `jumping` → `done`). That gives a gallery
of ready characters for free. Frame counts per row were not on the page I read; the importer
must take them from the pet's own `pet.json`. A later `"kind": "rive"` would be a second player
in code and a bundled runtime; the pack stays an asset and a value.

## (f) Build list

Small steps, each checked before the next.

| # | step | files | checked by |
| --- | --- | --- | --- |
| 1 | The mood rule | `core/companion.rs`, `core/mod.rs` | `cargo test companion`: each row of the mood table, both beats, `asking` over `working` |
| 2 | The value | `core/surfaces.rs`, `defaults/surfaces.json`, the example in `docs/structure.md` | `cargo test surfaces`: shipped equals default; a typo, `size: 9000`, `place: "middle"`, `engine: "../x"` are refused |
| 3 | The drawing, in the page | `ui/components/companion.rs`, `ui/views/companion.rs`, `ui/views/shell.rs`, `assets/styling/glass.css` | browser at `127.0.0.1:8090`: the character sits in the corner; run an engine → `working`; leave a message unread → `asking`; stop the host → `asleep`; with "reduce motion" on, it stands still |
| 4 | The bubble, in the page | `ui/views/bubble.rs`, `ui/views/companion.rs` | browser: click opens, a sent message gets its reply, Esc closes |
| 5 | The Mac character window | `shells/mac/companion.rs`, `shells/mac/mod.rs`, `structure.rs` | `cargo test structure`; `dx build --platform macos`; the character shows on every Space above other windows; typing in another app is never interrupted when it appears or changes mood; `top` shows about 1% or less while idle; the main window does not draw a second one |
| 6 | The Mac bubble window | `shells/mac/companion.rs` | by hand: click opens the panel beside the character, typing works, Esc and a second click close it, copy from another app and paste works |
| 7 | The phone shell | `shells/phone.rs`, `shells/mod.rs`, `core/places.rs`, `Dioxus.toml` (`[bundle] identifier`) | the `cargo check` line from (c); `dx build --ios`; with the host running, install and launch in the simulator and take a screenshot: the dashboard and the in-page bubble are there, not a blank screen |
| 8 | A real iPhone | `Dioxus.toml` (`[ios]`), an entitlements file, whatever question 3 decides for the host | the app opens on the phone and shows live numbers from the Mac |
| 9 | One fun behaviour at a time, each a new word in `place` or a new bool | `core/surfaces.rs`, `shells/mac/companion.rs` | by hand, plus `top` before and after. Order (mine): drag, peek, look at the pointer, Dock, notch |
| 10 | `failed` mood | `core/surfaces.rs` (`Glance`), `api/surfaces.rs`, `core/companion.rs` | a test with one engine in `error` |
| 11 | Packs | `core/companion.rs` (the pack contract), `core/manifest.rs`, `defaults/askk.json`, `api/surfaces.rs`, `ui/components/companion.rs` (sprite player), `host/` (the importer) | tests for every refusal in (e); one imported pet plays all moods on Mac, phone and web |
| 12 | Live Activity | a Swift widget extension folder, `Dioxus.toml` | only after 8 and the paid programme; the two numbers show on the Lock Screen |

Steps 3 and 4 come before the Mac window on purpose: the browser is the quickest place to look
at the character, and the same two components are then reused unchanged by steps 5 to 7.

## (g) Questions only the owner can answer

Most important first.

1. **Who is the companion?** A creature, an abstract shape, the askk mark? And which look: flat
   vector (the starter), pixel sprite, or a rigged character (Rive, paid editor)? I would start
   with a simple vector shape in the theme's colours.
2. **A real iPhone: is the paid Apple Developer Programme ($99 a year) wanted?** Without it:
   7-day installs on your own phone, no push, no TestFlight, no Live Activity updates in the
   background.
3. **How may a phone reach the host?** Open the host to the local network (then it needs a
   login; it has none), or keep it on loopback and reach it through a private tunnel such as
   Tailscale. I would choose the tunnel: no change to the sandbox profile, nothing exposed.
4. **On by default?** And should it hide over full-screen apps and while the screen is shared?
5. **May message text appear on the desktop** (a speech bubble with the newest message)? It
   would be visible to anyone looking and in screen shares. I would show the mood only.
6. **Which engine does the bubble talk to**: always `askk`, or whichever engine is waiting?
7. **Is importing other people's pet packs wanted?** Then the licence of each pack is the
   user's responsibility, and the app should show the pack's stated licence.
8. **Is a "companion plugin" only the look, or also behaviour** (where it sits, how it moves)? I
   assumed look only; behaviour stays code with a few words to choose from.
9. **Who owns the notch**: the existing notch panel, the companion, or either by value?
10. **Sound, ever?** I assumed never.

## Evidence

### The spike

A throwaway crate (dioxus `=0.7.10` with `desktop`, the repo's `Cargo.lock` copied so tao and wry
match), a 160×160 window, five drawing modes, 16 s each, sampled with `top`:

| mode | app | WebContent | GPU helper | sum |
| --- | --- | --- | --- | --- |
| still | 0.0 | 0.0 | 0.0 | 0.0 |
| CSS sprite, `background-position`, `steps(8)`, 0.8 s | 1.0 | 1.0 | 0.3 | 2.3 |
| CSS sprite, `transform`, `steps(8)`, 0.8 s | 1.3–1.6 | 1.3–1.4 | 0.1 | 2.7–3.1 |
| CSS continuous `transform` ("breathing") | 0.1–0.2 | 0.2–0.4 | 0.0 | about 0.5 |
| canvas redrawn every `requestAnimationFrame` (60 a second) | 4.9 | 5.3 | 7.0 | about 17 |

Window read-back three seconds after start: `ignoresMouseEvents=true isKeyWindow=false
canBecomeKeyWindow=false level=25`. A 33 ms Rust timer alone cost about 0.8%; with a pointer read
on each tick about 1.2%.

Also run: the iOS `cargo check`, `dx build --ios` on a copy, and one simulator launch (then the
app was removed and the simulator shut down). Side effect to know about: the first `xcrun simctl`
call made Xcode update its simulator service ("Install Succeeded").

### Not verified

- A real click passing through the window to the app below.
- Anything on a real iPhone; `dx serve --ios`; widget extensions; the Local Network setting.
- CPU of Lottie and Rive; WindowServer's share of any mode.
- The Petdex frame counts; the dotLottie licence at its repo.
- Everything marked **[memory]**.

### Sources

- Dioxus 0.7 bundling and mobile: <https://dioxuslabs.com/learn/0.7/tutorial/bundle>,
  <https://dioxuslabs.com/learn/0.7/guides/platforms/mobile>
- iOS `.ipa` pull request: <https://github.com/DioxusLabs/dioxus/pull/5591>
- Rive pricing, runtimes and sizes: <https://rive.app/pricing>, <https://rive.app/docs/runtimes>,
  <https://rive.app/docs/runtimes/runtime-sizes.md>
- dotLottie players: <https://docs.lottiefiles.com/en/runtimes>,
  <https://github.com/LottieFiles/dotlottie-rs>
- Live2D licence: <https://help.live2d.com/en/?p=2558>, <https://help.live2d.com/en/sdk>
- Spine licence: <https://en.esotericsoftware.com/spine-editor-license>
- Petdex: <https://github.com/crafter-station/petdex>
- Window list and permissions: <https://developer.apple.com/forums/thread/839069>
- Live Activity limits: <https://developer.apple.com/forums/thread/797676>
- Picture in Picture rules:
  <https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller>,
  <https://developer.apple.com/forums/thread/839424>
- Desktop pets that rely on clear-pixel click-through: <https://github.com/curzel-it/bit-therapy>
- Click-through in Tauri (same tao call): <https://github.com/tauri-apps/tauri/issues/11461>
- Locked crates read: `tao-0.34.8` (`platform_impl/macos/window.rs`, `util/async.rs`),
  `dioxus-desktop-0.7.10` (`Cargo.toml`), `dioxus-0.7.10` (`Cargo.toml`),
  `dioxus-fullstack-0.7.10` (`client.rs`)

## Build log

Steps 1 to 7 of the build list, built 2026-11-09. Steps 8 to 12 were not wanted and are not
started. Nothing was committed.

### Defaults used (the main session's choices, not the owner's)

A simple abstract vector shape in the theme's colours; `place: bottom-right`; on by default;
mood only, no message text on the desktop; the bubble talks to `askk`; no sound; the notch
stays with the existing notch panel; behaviour stays code, only the look becomes a pack later.

### Where the build differs from the plan above

1. **`working` now wins over `asking`** (the plan said the opposite). The plan read
   `Glance.waiting` as "an engine has left you a message". It is the other direction: mail
   not yet seen in an **engine's** box (`board().new_for(engine)`), and it stays unseen while
   that engine works on it. With the plan's rule a message sent from the bubble showed
   `asking` for the whole run and `working` never appeared (seen in the browser: idle → asking
   for 7 s → idle). Now: `working` when an engine runs; `asking` only when mail waits and
   nothing runs. This is my change to my own earlier choice; the owner may want it flipped, or
   may want a separate count of mail for the user.
2. **Neither the character nor the bubble is a page** (as planned), and no view name was added
   to `core/node.rs`.
3. **`Dioxus.toml` was not touched.** The bundle id stays `com.example.Askk`; choosing the real
   one is the owner's and is only needed for signing (step 8).
4. **`ui/views/live.rs` gained `Live::away()`**: the page's one listener already knew when the
   host stopped answering; the companion needed to read it to fall asleep.
5. **The host address for a phone** is `option_env!("ASKK_HOST")` in `core/places.rs`: the
   address given at build time, used when the running environment names none.

### Files

Added:

| file | holds |
| --- | --- |
| `src/core/companion.rs` | `Mood`, `Beat`, `mood()`, `beat()` and their tests |
| `src/ui/components/companion.rs` | the drawing: one inline SVG, the mood as a class |
| `src/ui/views/companion.rs` | `CompanionView` (live mood, click), `PageCompanion` (in the page), `CharacterFace` and `BubbleFace` (window roots), the `Outside` and `Dismiss` contexts |
| `src/ui/views/bubble.rs` | `BubbleView`: compact chat with one engine |
| `src/shells/mac/companion.rs` | the Mac face: character window, bubble window |
| `src/shells/phone.rs` | the phone shell: sets the host address, launches the page |

Edited (narrow edits only):

| file | change |
| --- | --- |
| `src/core/mod.rs` | `pub mod companion;` |
| `src/core/surfaces.rs` | `Companion`, `Bubble`, `Corner`; `Surfaces.companion`; checks; one test; the example |
| `src/core/places.rs` | `host_url()` also takes the build-time address |
| `defaults/surfaces.json` | the `companion` value |
| `src/ui/components/mod.rs`, `src/ui/views/mod.rs` | the new modules |
| `src/ui/views/live.rs` | `Live::away()` |
| `src/ui/views/shell.rs` | draws `PageCompanion` over the page |
| `assets/styling/glass.css` | the companion's rules, appended at the end |
| `src/shells/mac/mod.rs` | the face is called; `Outside` is provided; the table |
| `src/shells/mod.rs`, `src/shells/web.rs` | the phone shell is picked on `mobile` |
| `src/structure.rs` | `companion.rs` in the list of Mac faces |
| `docs/structure.md` | the `surfaces.json` example and one "where to go" row |

### Checks made by a tool

| check | evidence |
| --- | --- |
| tests | `cargo test --locked --no-default-features --features server`: **161 passed, 0 failed** (the three failures named beforehand did not occur). Includes 5 tests in `core::companion`, the new `core::surfaces` test (a file without the key takes the default; a typo, `place: "middle"`, `size: 9000`, a 10-point bubble and `engine: "../x"` are refused) and `structure::each_mac_face_is_one_file` |
| compile | `cargo check --locked --no-default-features` with `--features server`; `--features web --target wasm32-unknown-unknown`; `--features desktop`; `--features mobile --target aarch64-apple-ios-sim`: all four finish. The only warnings are in files I did not touch (`api/mod.rs`, `api/talk.rs`, `host/infer/connectors.rs`) |
| builds | `dx build --platform web`, `dx build --platform macos`, `ASKK_HOST=http://127.0.0.1:8141 dx build --ios`: all three complete |
| host | `PORT=8141 ASKK_HOME=/Volumes/Backup/askk scripts/sandboxed.sh`; the home's `surfaces.json` has no `companion` key and the companion appeared with its defaults |
| browser: idle | the first HTML already holds the character; class `companion idle`, fill `rgb(184, 174, 240)` (the theme's accent), body animation `c-breathe`; drawn bottom-right (screenshot) |
| browser: bubble | a click opens the panel (372×510 in a 1024×768 page), the field has the keyboard, the log shows `askk`'s conversation. A typed message and Return, done twice: it shows at once dimmed and the reply `ok` arrives; in the second run (after a fix) the dimmed copy is gone once the conversation holds it. Esc closes the panel |
| browser: working | second message: `idle` → `working` (blue, the arc circling; screenshot) for about 7 s → `idle` |
| browser: asking | seen drawn (amber, the dot) under the first rule during the first message; under the present rule it appeared for 15 ms as the run ended (the host marks "not running" just before "mail seen"). The present rule itself is covered by the unit tests, not by a browser run with mail left waiting |
| browser: asleep | host stopped: within about a second the class is `companion asleep`, grey fill, eyes replaced by lids, no animation. Host started again: back to `idle` **without reloading the page** |
| Mac: one character | the app run against the host; its windows listed with `CGWindowListCopyWindowInfo`: exactly one 96×96 window at the floating level, on screen, at x=1616 y=1005 on a 1728×1117 screen (16 points from the right and bottom edges), beside the 360×34 notch panel and the main window. Two launches, same result |
| Mac: bubble opens | a click posted to the app's process only (`CGEvent.postToPid`, the real pointer not moved) made a second floating window of 380×520 at x=1332 y=477: the bubble's size, right-aligned with the character, 8 points above it. In the first launch such a window was already there and on screen although I had sent nothing: someone at the screen most likely clicked the character (in the second launch a tooltip window of the app appeared, which takes a real pointer resting on it) |
| Mac: never takes focus | by the window's construction (`with_focusable(false)`) and the spike (`canBecomeKeyWindow=false`, a click still reaches the page); not read back from the built app |
| simulator | iPhone 17 Pro (iOS 26.3): the app shows the dashboard with live cards from the host and the in-page character bottom-right, where the same step showed a blank white screen before (screenshot) |

### Not verified, needs eyes

- **The Mac bubble closing and reopening.** After the posted click the bubble's window existed
  but was listed as not on screen, and two more posted clicks did not change that; meanwhile
  another app came to the front and every window of the app went off screen, so someone was
  using the Mac and my readings are not clean. Please click the character: the bubble should
  open beside it, take the keyboard, and close with Esc, × or a second click.
- That the character never interrupts typing in another app when it appears or changes mood.
- The character over full-screen apps and on a second display (it is placed on the main
  screen only).
- How the motion looks: every mood was seen as one still frame, never as movement.
- CPU of the real character window (the spike's numbers are for a stand-in).
- Top corners and left corners; only `bottom-right` was looked at.
- A real iPhone; the bubble inside the simulator (only the first screen was captured).
- Light theme in the browser (the simulator showed light; the browser was dark).

### Known rough edges

- `asking` flashes for about 15 ms when a run ends (see above). The colour change is eased
  over 300 ms, so it should not be visible; a short hold before showing `asking` would remove
  it.
- The bubble shows tool calls of the model as plain lines (`→ ack()`), and no attachments.
- Opening the Mac bubble brings the app to the front (it must, to take the keyboard). My
  posted click did this once while someone was using the Mac.
- In the simulator the engine icons show as boxed question marks (emoji; not part of this
  work).
- A phone build finds the host only at the address given when it was built.

### Left behind by the checks

- Two test messages in `askk`'s conversation in `/Volumes/Backup/askk` ("Companion bubble
  check…", "Second companion check…"), each answered `ok`; `askk`'s step summary on the
  dashboard now speaks of the second one. Nothing under `data/engines` was edited by hand.
- `/Volumes/Backup/askk/bin/askk-host` and `bin/public` are the build made here
  (`scripts/sandboxed.sh` copies them on every start). `askk.pid` names my stopped host; the
  next host takes the lock over.
- Stopped: my host (port 8141), my Mac app, the simulator (app removed). The first `xcrun
  simctl` use today made Xcode update its simulator service.

Starter build finished.

### Checked afterwards by the main session (2026-11-09)

- Tests: `cargo test --no-default-features --features server`: 161 passed, 0 failed. Desktop and web targets compile.
- **Bug found by a real pointer click, fixed:** in the page the character could not be clicked. `.companion-btn { all: unset }` came after `.companion-dock > * { pointer-events: auto }` with the same weight, so the button took `pointer-events: none` from the dock (a scripted `.click()` ignores that, which is how the first check passed). Fix: `pointer-events: auto` in the `.companion-btn` rule of `assets/styling/glass.css`. After it: a real click opens the bubble beside the character, the field has the keyboard, Esc closes it (browser, own host on a scratch home).
- Seen by eye in the browser: the character bottom-right, idle, breathing and blinking, in dark and light theme.
- **Mac, seen by eye (full-screen control approved by the owner, 23:54):** the character floats bottom-right on the desktop; a click opens the bubble above it with the keyboard in the field; Esc closes it; a click reopens it; a second click closes it. The notch panel shows `0 running · 0 waiting`.
- **Second bug found by eye, fixed:** the character sat in a black square. The stylesheet's `body { background: var(--bg) }` beat the window's `html,body{background:transparent}` (same weight, order not ours). Fix: `!important` on the transparent rule in `src/ui/views/companion.rs` (`Stage`) and in the bare face of `src/ui/views/shell.rs` (the notch panel had the same weakness). After it: no box, wallpaper shows around the character and through the notch pill.
- Not shown over a full-screen Space: macOS hides the character there (owner question 4).
