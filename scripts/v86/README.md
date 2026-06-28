# Custom v86 Alpine images (`build-image.sh`)

The in-browser terminal view runs Alpine Linux under [v86](https://github.com/copy/v86)
as a no-GUI serial console. On deployed gh-pages **the VM has no network**, so
`apk add` can never run in the browser.

**`build-image.sh` is the ONLY place packages are installed.** It bakes the
requested packages into the disk image at build time on a dev machine; the
browser then resumes that frozen machine with everything already present.

## Usage

```sh
# Bake python + pip into an image called "alpine-python":
scripts/v86/build-image.sh --packages python3,py3-pip --out alpine-python

# Validate args / print the plan without any heavy toolchain (CI-safe):
scripts/v86/build-image.sh --packages python3 --out alpine-python --dry-run

scripts/v86/build-image.sh --help
```

| Flag         | Meaning                                                         |
| ------------ | -------------------------------------------------------------- |
| `--packages` | Comma-separated apk package list, e.g. `python3,py3-pip,gcc`.  |
| `--out`      | Artifact id (bare name, no slashes). Becomes the filename.     |
| `--dry-run`  | Validate + print the plan; needs no bun/node/v86 image.        |
| `--help`     | Show usage.                                                    |

## Output

```
assets/runtimes/v86/<out-id>.bin    # v86 save_state blob the browser loads
assets/runtimes/v86/<out-id>.json   # sidecar: {id, base, packages, format, built_at}
```

This is where the runtime / staging step picks images up (alongside
`assets/runtimes/python/`, `assets/runtimes/coreutils/`).

## How it works

1. Boot a base Alpine v86 image headless in Node/Bun via the `v86` npm package.
2. Drive the serial console: `apk update && apk add <packages>`.
3. Call `emulator.save_state()` and write the bytes to `<out-id>.bin`.

The browser boots that blob with `restore_state` — instant, no network needed.

## Prerequisites (real build only — `--dry-run` needs none)

- **bun** or **node >= 18** to run the headless driver.
- the **`v86` npm package** installed where the driver can `import` it
  (`node_modules/v86/`), plus its `build/v86.wasm`.
- a **base Alpine v86 image** — either a bootable `save_state` `.bin` or a kernel
  `bzImage` (e.g. from the v86 project's `images/`).

Point the script at them with env vars:

| Env                | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `V86_BASE_STATE`   | Path/URL to a base Alpine v86 `save_state` `.bin`.       |
| `V86_BASE_BZIMAGE` | Path/URL to a base kernel `bzImage` (alt to a state).    |
| `V86_WASM_PATH`    | Path to `v86.wasm` (default `node_modules/v86/build/v86.wasm`). |
| `V86_RUNNER`       | `bun` or `node` (default: bun if present, else node).    |
| `BOOT_TIMEOUT`     | Seconds to wait for boot + apk (default `180`).          |

### Manual real-run example

```sh
bun add v86            # or: npm i v86
export V86_BASE_STATE=./base/alpine-state.bin
scripts/v86/build-image.sh --packages python3,py3-pip --out alpine-python
# -> assets/runtimes/v86/alpine-python.bin (+ .json)
```

A real boot/bake is **not** run in CI (too heavy) — CI uses `--dry-run` only.

## Known ceilings

- Requires bun/node + a base v86 image; **not fully offline at build time**
  (apk needs the network on the dev box, just never in the browser).
- **x86-only** — v86 emulates x86, so images are single-arch.
- qemu (`qemu-img` + an Alpine ISO + `apk` in a chroot, then convert to a flat
  raw disk) is a valid alternative path but heavier to set up; the v86
  `save_state` route was chosen because the browser runtime already loads
  `save_state` blobs, so there's no extra conversion step.
