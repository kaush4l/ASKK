# v86 image hosting

The in-browser v86 view (Alpine Linux, no-GUI serial terminal) boots from a
disk image fetched at runtime. This folder is the plumbing that gets those
images from a build host into the deployed site and tells the app where to find
them.

## The manifest

`scripts/v86/manifest.json` is the single source of truth for which images
exist. The Rust view reads it from `assets/runtimes/v86/manifest.json` at
runtime. Shape:

```json
{ "images": [
  { "id": "alpine-base", "label": "Alpine (base)", "url": "runtimes/v86/alpine-base.state", "type": "state", "bytes": 0, "packages": ["busybox"] }
]}
```

- `id` — stable key the view uses to pick an image.
- `label` — what the user sees in the picker.
- `url` — where to fetch the image (see resolution below).
- `type` — one of `state` | `flat` | `bzimage` | `cdrom` (how v86 loads it).
- `bytes` — expected size (0 = placeholder until the build unit fills it in).
- `packages` — what was baked in, for the label/tooltip.

## Where images live

Two storage tiers, same as the rest of the app:

- **Small enough for the ≤45 MB repo budget** → commit the image under
  `assets/runtimes/v86/` (like `assets/runtimes/coreutils/wc.wasm`). It travels
  with the repo and `stage.sh` copies it into the deploy.
- **Too big to commit** → keep it out of git (the build host produces it with
  `scripts/v86/build-image.sh`), fetch it onto the host, and let `stage.sh`
  inject it at deploy time. This mirrors how `models/` works for multi-GB
  weights — out of the repo, staged next to the published site.

Either way the runtime path is the same; only whether the bytes are in git
differs.

## How `url` resolves under `--base-path /ASKK/`

The release build is `dx build --release --web --base-path /ASKK/`, so the live
site lives under `https://…/ASKK/`. The view resolves each `url` against the
page base (`document.baseURI`, i.e. `https://…/ASKK/`), exactly like the
`models/` runtime does (`new URL("models/", document.baseURI)`).

So a manifest `url` of `runtimes/v86/alpine-base.state` resolves to:

```
https://…/ASKK/runtimes/v86/alpine-base.state
```

`stage.sh` is what makes that path real: it writes the image to
`<publish-dir>/assets/runtimes/v86/…`. The Rust view fetches the *manifest*
through the bundled `asset!()` path and reads image `url`s relative to base —
keep the `url`s pointing at the staged location the view expects. If you change
where `stage.sh` writes, change the `url`s to match.

> Why not just `asset!()` the images? `asset!()` content-hashes every file
> (`alpine-base-dxhAB12….state`), so there's no stable URL to put in a
> hand-written manifest. `stage.sh` copies images verbatim to a predictable
> path instead — same trick `models/` uses.

## Scripts

```bash
# (optional) pull pre-built images whose manifest url is absolute (http/https).
# Local images (relative url) are built by build-image.sh and skipped here.
scripts/v86/fetch.sh                 # all absolute-url images
scripts/v86/fetch.sh alpine-base     # just one id

# build the site
dx build --release --web --base-path /ASKK/

# stage images + manifest into the publish output before deploying
scripts/v86/stage.sh target/dx/askk/release/web/public
```

`stage.sh` always copies the manifest; if there are no image files yet it says
so and exits 0 (manifest-only is a valid intermediate state — the picker shows
the entries even before the bytes land).

## Adding a custom image

1. Build it: `scripts/v86/build-image.sh …` (bakes your packages into a
   `.state` snapshot).
2. Drop the output in `assets/runtimes/v86/` (commit it if it fits the budget;
   otherwise leave it on the build host only).
3. Add a manifest entry: a new object in `images[]` with a unique `id`, a
   `url` of `runtimes/v86/<file>`, the right `type`, and the `packages` you
   baked in.
4. Re-stage: `scripts/v86/stage.sh target/dx/askk/release/web/public`, then
   deploy. The new image shows up in the view's picker.
