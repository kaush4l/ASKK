// Loaded projects: the folder rules, the registry (config + the owner's file), the self-ignoring .agents/ folder.
// A temp home, ASKK folder and projects, removed after.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AGENTS_IGNORE, checkProjectPath, projectName, projectRegistry } from "./projects.js"

const top = realpathSync(mkdtempSync(join(tmpdir(), "projects-test-")))
const home = join(top, "home")
const askk = join(home, "askk")
const app = join(home, "code", "My App")
const api = join(home, "code", "api")
for (const dir of [join(askk, "custom"), app, api, join(home, ".ssh"), join(home, "Library", "x")]) mkdirSync(dir, { recursive: true })
writeFileSync(join(app, "package.json"), "{}\n")
writeFileSync(join(home, "code", "notes.txt"), "x\n")
symlinkSync(api, join(home, "code", "api-link"))
afterAll(() => rmSync(top, { recursive: true, force: true }))
const opts = { askkRoot: askk, home, system: [] }

describe("checkProjectPath", () => {
  test("an existing folder, absolute or ~/…; links resolve to the real folder", () => {
    expect(checkProjectPath(app, opts)).toBe(app)
    expect(checkProjectPath("~/code/api", opts)).toBe(api)
    expect(checkProjectPath(join(home, "code", "api-link"), opts)).toBe(api)
  })
  test("refused: relative, missing, a file, home or above, ~/.dot and ~/Library, ASKK in or around, system folders", () => {
    const why = (p, o = opts) => {
      try {
        checkProjectPath(p, o)
        return "accepted"
      } catch (error) {
        return `${error.status} ${error.message}`
      }
    }
    expect(why("code/api")).toMatch(/^400 .*relative/)
    expect(why(join(home, "nope"))).toMatch(/^404/)
    expect(why(join(home, "code", "notes.txt"))).toMatch(/^400 .*file/)
    expect(why(home)).toMatch(/^403 .*home/)
    expect(why(top)).toMatch(/^403 .*home/)
    expect(why(join(home, ".ssh"))).toMatch(/^403 .*\.ssh/)
    expect(why(join(home, "Library", "x"))).toMatch(/^403 .*Library/)
    expect(why(askk)).toMatch(/^403 .*ASKK/)
    expect(why(join(askk, "custom"))).toMatch(/^403 .*ASKK/)
    expect(why(app, { ...opts, system: [join(home, "code")] })).toMatch(/^403 .*system/)
    expect(why("")).toMatch(/^400/)
  })
  test("projectName: the folder's name, lower case with dashes", () => {
    expect(projectName(app)).toBe("my-app")
    expect(projectName("/x/2024 site")).toBe("p-2024-site")
    expect(projectName("/x/A")).toBe("project")
  })
})

describe("projectRegistry", () => {
  const file = join(top, "memory", "lab-desk", "projects.json")
  const local = (name) => name === "demo-app"
  const log = []
  const registry = projectRegistry({ file, seed: { api: "~/code/api", bad: "~/nope", "demo-app": "~/code/api" }, local, ...opts, clock: () => new Date("2026-10-17T21:30:00Z"), log: (l) => log.push(l) })

  test("config projects are checked at start: the bad and the shadowed are left out with a log line", () => {
    expect(registry.list().map((e) => [e.name, e.source])).toEqual([["api", "config"]])
    expect(log.join("\n")).toMatch(/projects\.bad left out: No folder/)
    expect(log.join("\n")).toMatch(/projects\.demo-app left out: .*desk's own/)
    expect(readFileSync(join(api, ".agents", ".gitignore"), "utf8")).toBe(AGENTS_IGNORE)
  })

  test("load: named from the folder, saved to the owner's file, .agents/ made (ignoring itself); the same folder again is that entry", () => {
    const { entry, created } = registry.load({ path: app })
    expect(created).toBe(true)
    expect(entry).toEqual({ name: "my-app", path: app, source: "owner", at: "2026-10-17T21:30:00.000Z" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ projects: { "my-app": { path: app, at: "2026-10-17T21:30:00.000Z" } } })
    expect(readFileSync(join(app, ".agents", ".gitignore"), "utf8")).toBe("# The agents' files for this project (ASKK): never committed.\n*\n")
    expect(registry.folder("my-app")).toBe(app)
    expect(registry.load({ path: `${app}/` }).created).toBe(false)
    expect(registry.list().find((e) => e.name === "my-app")).toMatchObject({ missing: false, setup: false })
    writeFileSync(join(app, ".agents", "project.md"), "# My App\n")
    expect(registry.list().find((e) => e.name === "my-app").setup).toBe(true)
  })

  test("names: taken by a loaded project, the desk's own, or malformed → refused", () => {
    const other = join(home, "code", "other")
    mkdirSync(other)
    const status = (input) => {
      try {
        registry.load(input)
        return "loaded"
      } catch (error) {
        return error.status
      }
    }
    expect(status({ path: other, name: "api" })).toBe(409)
    expect(status({ path: other, name: "demo-app" })).toBe(409)
    expect(status({ path: other, name: "Other" })).toBe(400)
    expect(status({ path: other, name: "other-app" })).toBe("loaded")
  })

  test("the owner's file edited by hand is read again; a moved folder is missing and never mounted", () => {
    const moved = join(home, "code", "moved")
    writeFileSync(file, JSON.stringify({ projects: { gone: { path: moved, at: null }, ...JSON.parse(readFileSync(file, "utf8")).projects } }))
    expect(registry.list().find((e) => e.name === "gone")).toMatchObject({ missing: true })
    expect(registry.folder("gone")).toBeNull()
    expect(registry.folder("../etc")).toBeNull()
  })

  test("unload: the owner's go; a configured one stays (main.js's), an unknown one is 404", () => {
    expect(registry.unload("my-app")).toBe(true)
    expect(registry.folder("my-app")).toBeNull()
    expect(existsSync(join(app, ".agents"))).toBe(true) // the project's own folder is never touched
    expect(() => registry.unload("api")).toThrow(/main\.js/)
    expect(() => registry.unload("nope")).toThrow(/No loaded project/)
  })

  test("a desk without a registry file loads from main.js only", () => {
    expect(() => projectRegistry({ ...opts }).load({ path: app })).toThrow(/main\.js only/)
  })
})
