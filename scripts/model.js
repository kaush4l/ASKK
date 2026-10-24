// A local model from the command line (companion/models/registry.js; the add-model skill, .claude/skills/add-model):
// what the models folder holds, whether a model.md is wired right, and a live test through the desk server.
//
//   bun scripts/model.js list
//        every model per kind: chosen, ready or what is missing, its folder
//   bun scripts/model.js check <kind>/<name>
//        its model.md read as the host reads it: the problem if any, programs missing, modes, options, the argv a call
//        would run (command engines); exit 0 when it is ready, else 1
//   bun scripts/model.js test <kind>/<name> [--audio <16 kHz wav>] [--text "<line>"] [--prompt "<image prompt>"]
//        [--steps <n>] [--port <n>]
//        through the live desk server (default ASKK_DESKS_PORT or 1111; never a side process): stt transcribes the clip
//        (default: a line `say` speaks), tts speaks the text, image draws the prompt — twice (first: loads or downloads
//        the weights; warm: the speed it will have), then the selection the kind had is put back; the output goes to
//        ./.model-test/<kind>-<name>.<wav|png>; exit 0 when both calls worked

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { buildArgv, loadModels } from "../companion/models/registry.js"
import { hostClient } from "../companion/team/compose.js"
import { DESKS_PORT } from "../companion/shared/config.js"

const USAGE = `usage: bun scripts/model.js list
       bun scripts/model.js check <kind>/<name>
       bun scripts/model.js test <kind>/<name> [--audio clip.wav] [--text "…"] [--prompt "…"] [--steps n] [--port n]`
const LINE = "Computer, open the studio and draw a red fox in the snow."

function target(arg) {
  const [kind, name] = String(arg ?? "").split("/")
  if (!["stt", "tts", "image"].includes(kind) || !name) throw new Error(`${arg ?? "(none)"}: <kind>/<name>, kind stt | tts | image\n${USAGE}`)
  return { kind, name }
}

function list(models) {
  for (const kind of ["stt", "tts", "image"]) {
    const chosen = models.selected(kind)?.name
    console.log(`${kind}:`)
    for (const m of models.list(kind)) {
      const r = models.ready(m)
      const state = !m.ok ? `broken: ${m.problem}` : r.ready ? "ready" : `missing ${r.missing.join(", ")}`
      console.log(`  ${m.name === chosen ? "*" : " "} ${m.name.padEnd(18)} ${m.engine ?? "?"} · ${state}`)
    }
    const more = models.catalog(kind).filter((c) => !c.added)
    if (more.length) console.log(`    catalogue: ${more.map((c) => c.name).join(", ")}`)
  }
  console.log(`folder: ${models.root}`)
}

function check(models, { kind, name }) {
  const m = models.get(kind, name)
  console.log(`${kind}/${name}: ${m.file}`)
  if (!m.ok) {
    console.log(`  problem: ${m.problem}`)
    return false
  }
  const r = models.ready(m)
  console.log(`  engine ${m.engine} · ${r.ready ? "ready" : `missing ${r.missing.join(", ")}${m.install ? ` — install: ${m.install}` : ""}`}`)
  if (m.meta.url) console.log(`  server ${m.meta.url} · model ${m.meta.model ?? "(none)"}${m.meta.serve?.bin ? ` · started as ${m.meta.serve.bin} ${(m.meta.serve.args ?? []).join(" ")}` : " · not started by the helper"}`)
  for (const [mode, spec] of Object.entries(m.modes ?? {})) console.log(`  mode ${mode}: ${spec.bin} — inputs ${Object.keys(spec.inputs ?? {}).join(", ") || "none"}`)
  for (const [k, o] of Object.entries(m.options ?? {})) console.log(`  option ${k}: ${o.type} = ${JSON.stringify(m.values?.[k] ?? o.default)}${o.flag ? ` (${o.flag})` : ""}${o.field ? ` (field ${o.field})` : ""}`)
  if (r.ready && m.engine === "command") {
    const sample = { stt: { audio: "/tmp/clip.wav", dir: "/tmp", stem: "clip", language: "en" }, tts: { text: "Hello", out: "/tmp/out.wav" }, image: { prompt: "a fox", out: "/tmp/out.png", width: 1024, height: 1024, steps: 4, seed: 1 } }[kind]
    for (const mode of Object.keys(m.modes)) console.log(`  argv (${mode}): ${JSON.stringify(buildArgv(m, mode, sample))}`)
  }
  return r.ready || m.engine === "openai"
}

async function timed(f) {
  const t = Date.now()
  try {
    return { ok: true, out: await f(), ms: Date.now() - t }
  } catch (error) {
    return { ok: false, error: error.message, ms: Date.now() - t }
  }
}

async function test(models, { kind, name }, args) {
  const port = Number(args.port ?? DESKS_PORT)
  const host = hostClient({ port })
  let before
  try {
    before = (await host.get("models")).kinds[kind].selected
  } catch (error) {
    throw new Error(`the desk server does not answer on port ${port} (${error.message}) — start askk.desks; tests run only on the live server`)
  }
  const out = join(process.cwd(), ".model-test")
  mkdirSync(out, { recursive: true })
  const calls = []
  try {
    if (kind === "stt") {
      let clip = args.audio
      if (!clip) {
        clip = join(out, "line.wav")
        const say = Bun.spawnSync(["say", "--data-format=LEI16@16000", "-o", clip, LINE])
        if (say.exitCode !== 0) throw new Error("no clip: pass --audio <16 kHz mono wav> (say is macOS only)")
      }
      const wav = Buffer.from(await Bun.file(clip).arrayBuffer())
      const at = wav.indexOf("data")
      if (at < 0) throw new Error(`${clip}: not a WAV`)
      const audio = wav.subarray(at + 8).toString("base64")
      await host.post("models/select", { kind, name })
      for (const round of ["first", "warm"]) calls.push([round, await timed(async () => JSON.stringify((await host.post("speech/transcribe", { audio })).text))])
    } else if (kind === "tts") {
      await host.post("models/select", { kind, name })
      for (const round of ["first", "warm"])
        calls.push([
          round,
          await timed(async () => {
            const r = await host.post("speech/say", { text: args.text ?? LINE })
            const file = join(out, `${kind}-${name}.wav`)
            await Bun.write(file, Buffer.from(r.audio, "base64"))
            return `${r.type}, ${Math.round((r.audio.length * 0.75) / 1024)} KB → ${file}`
          }),
        ])
    } else {
      for (const round of ["first", "warm"])
        calls.push([
          round,
          await timed(async () => {
            const { job } = await host.post("image/generate", { model: name, prompt: args.prompt ?? "a red fox in fresh snow, morning light", steps: Number(args.steps ?? 4), width: 512, height: 512, seed: 7, by: "model-test" })
            for (;;) {
              await Bun.sleep(2000)
              const j = (await host.get(`image/job?id=${job.id}`)).job
              if (j.status === "done") {
                const file = join(out, `${kind}-${name}.png`)
                await Bun.write(file, await (await fetch(`http://localhost:${port}${j.url}`)).arrayBuffer())
                return `${job.id} → ${file}`
              }
              if (!["queued", "running"].includes(j.status)) throw new Error(`${job.id} ${j.status}: ${j.error ?? ""}`)
            }
          }),
        ])
    }
  } finally {
    if (kind !== "image" && before && before !== name) await host.post("models/select", { kind, name: before }).catch(() => {})
  }
  for (const [round, r] of calls) console.log(`${kind}/${name} ${round}: ${r.ok ? r.out : `FAILED ${r.error}`} (${r.ms} ms)`)
  if (kind !== "image" && before && before !== name) console.log(`${kind} is back on ${before} (select ${name} in the panel to keep it)`)
  return calls.length > 0 && calls.every(([, r]) => r.ok)
}

async function main() {
  const { values: args, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { audio: { type: "string" }, text: { type: "string" }, prompt: { type: "string" }, steps: { type: "string" }, port: { type: "string" } } })
  const [command, which] = positionals
  const models = loadModels()
  if (command === "list") return list(models)
  if (command === "check") return void (process.exitCode = check(models, target(which)) ? 0 : 1)
  if (command === "test") return void (process.exitCode = (await test(models, target(which), args)) ? 0 : 1)
  throw new Error(USAGE)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
