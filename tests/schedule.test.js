import { test, expect } from "bun:test"
import {
  MARKER,
  createCronJob,
  cronTools,
  defaultLaunch,
  deleteCronJob,
  goalOf,
  hostLaunchLine,
  listCronJobs,
  managed,
  reasonNotToWrite,
  shellQuote,
  updateCronJob,
} from "../core/schedule.js"
import { memoryCron } from "../core/ports/cron-memory.js"

const FOREIGN = ["# somebody else's crontab", "0 3 * * * /usr/bin/backup.sh", "@daily /opt/rotate"]

/** @param {string[]} [lines] @param {any} [fault] */
function deps(lines = [], fault = undefined) {
  const cron = memoryCron({ lines, fault })
  return { d: { cron, launch: defaultLaunch }, cron }
}

// ── the rules ────────────────────────────────────────────────────────────

test("a name is letters, digits, dashes and underscores", () => {
  expect(reasonNotToWrite("build_2-a", "* * * * *", "go")).toBe("")
  for (const bad of ["", "with space", "semi;colon", "quote'd", "sl/ash"]) {
    expect(reasonNotToWrite(bad, "* * * * *", "go")).toBe("name must be letters, digits, dashes or underscores")
  }
})

test("a schedule is five fields, or exactly one of the eight shortcuts", () => {
  expect(reasonNotToWrite("a", "30 9 * * 1-5", "go")).toBe("")
  for (const ok of ["@reboot", "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]) {
    expect(reasonNotToWrite("a", ok, "go")).toBe("")
  }
  expect(reasonNotToWrite("a", "30 9 * *", "go")).toBe(
    "schedule needs 5 fields — minute hour day month weekday — but got 4",
  )
  const shortcuts = "@annually, @daily, @hourly, @midnight, @monthly, @reboot, @weekly, @yearly"
  expect(reasonNotToWrite("a", "@fortnightly", "go")).toBe(
    `'@fortnightly' is not a cron shortcut; use one of: ${shortcuts}`,
  )
  // one of the eight, but not alone
  expect(reasonNotToWrite("a", "@daily extra", "go")).toBe(`'@daily' is not a cron shortcut; use one of: ${shortcuts}`)
})

test("a goal is required, and neither field may forge a line or an owner", () => {
  expect(reasonNotToWrite("a", "* * * * *", "  ")).toBe("goal is required")
  expect(reasonNotToWrite("a", "   ", "go")).toBe("schedule is required")
  const refusal = `goal must be one line and must not contain '${MARKER}'`
  expect(reasonNotToWrite("a", "* * * * *", "go\n0 0 * * * rm -rf /")).toBe(refusal)
  expect(reasonNotToWrite("a", "* * * * *", `go ${MARKER}mine`)).toBe(refusal)
  expect(reasonNotToWrite("a", `* * * * * ${MARKER}x`, "go")).toBe(
    `schedule must be one line and must not contain '${MARKER}'`,
  )
})

// ── the line ─────────────────────────────────────────────────────────────

test("a line without the marker is nobody's business of ours", () => {
  for (const line of FOREIGN) expect(managed(line)).toBeNull()
  // marked, but with no command after the schedule fields
  expect(managed(`0 3 * * * ${MARKER}empty`)).toBeNull()
})

test("a managed line breaks back into its parts, five fields or one shortcut", () => {
  const line = `30 9 * * 1-5 ${defaultLaunch("build", "check the build")} ${MARKER}build`
  expect(managed(line)).toEqual({
    name: "build",
    schedule: "30 9 * * 1-5",
    command: defaultLaunch("build", "check the build"),
    goal: "check the build",
  })
  expect(managed(`@daily ${defaultLaunch("d", "tidy up")} ${MARKER}d`)?.schedule).toBe("@daily")
})

test("the goal survives quoting, and unbalanced quotes hand back nothing", () => {
  for (const goal of ["plain", "two words", "it's a goal", 'say "hi" now', "a $PATH and a `tick`"]) {
    expect(goalOf(defaultLaunch("j", goal))).toBe(goal)
  }
  expect(goalOf("main.py 'never closed >> log 2>&1")).toBe("")
  expect(goalOf("/usr/bin/backup.sh")).toBe("")
})

test("shell quoting leaves safe words alone and closes over the rest", () => {
  expect(shellQuote("plain-word.txt")).toBe("plain-word.txt")
  expect(shellQuote("")).toBe("''")
  expect(shellQuote("it's")).toBe(`'it'"'"'s'`)
})

test("the host launch line captures PATH, in order and without repeats", () => {
  const launch = hostLaunchLine({ project: "/p", executable: "/usr/bin/python3", path: "/a:/b:/a::/c" })
  expect(launch("build", "check the build")).toBe(
    "cd /p && PATH=/a:/b:/c /usr/bin/python3 main.py 'check the build' >> /p/agents/main/cron-build.log 2>&1",
  )
  expect(goalOf(launch("build", "check the build"))).toBe("check the build")
})

// ── the tools ────────────────────────────────────────────────────────────

test("listing says so when there is nothing, and reads the goal back when there is", async () => {
  const { d } = deps()
  expect(await listCronJobs(d)).toBe("No scheduled jobs.")
  await createCronJob(d, "build", "30 9 * * 1-5", "check the build")
  await createCronJob(d, "tidy", "@daily", "tidy the space")
  expect(await listCronJobs(d)).toBe("build: 30 9 * * 1-5 — check the build\ntidy: @daily — tidy the space")
})

test("a foreign line is listed by nobody, changed by nothing and deleted never", async () => {
  const { d, cron } = deps([...FOREIGN])
  expect(await listCronJobs(d)).toBe("No scheduled jobs.")
  expect(await deleteCronJob(d, "backup.sh")).toBe(
    "No job named 'backup.sh'. Use list_cron_jobs to see what is scheduled.",
  )
  await createCronJob(d, "build", "@hourly", "check the build")
  await deleteCronJob(d, "build")
  expect(cron.lines).toEqual(FOREIGN)
})

test("creating refuses twice over the same name, and says what to use instead", async () => {
  const { d, cron } = deps()
  expect(await createCronJob(d, "build", "30 9 * * 1-5", "check the build")).toBe(
    "Scheduled 'build': 30 9 * * 1-5 — the agent will run on 'check the build'.",
  )
  expect(await createCronJob(d, "build", "@daily", "again")).toBe(
    "A job named 'build' already exists. Use update_cron_job to change it.",
  )
  expect(cron.lines.length).toBe(1)
  expect(cron.lines[0]).toBe(`30 9 * * 1-5 ${defaultLaunch("build", "check the build")} ${MARKER}build`)
  expect(await createCronJob(d, "b ad", "@daily", "go")).toBe(
    "Not scheduled: name must be letters, digits, dashes or underscores",
  )
})

test("updating changes timing, goal, or both — and refuses to change nothing", async () => {
  const { d, cron } = deps()
  await createCronJob(d, "build", "30 9 * * 1-5", "check the build")
  expect(await updateCronJob(d, "build", "", "")).toBe("Nothing to change: give a new schedule, a new goal, or both.")
  expect(await updateCronJob(d, "gone", "@daily", "")).toBe(
    "No job named 'gone'. Use list_cron_jobs to see what is scheduled.",
  )
  expect(await updateCronJob(d, "build", "@daily", "")).toBe(
    "Updated 'build': @daily — the agent will run on 'check the build'.",
  )
  expect(await updateCronJob(d, "build", "", "ship it")).toBe(
    "Updated 'build': @daily — the agent will run on 'ship it'.",
  )
  expect(cron.lines[0]).toBe(`@daily ${defaultLaunch("build", "ship it")} ${MARKER}build`)
  expect(await updateCronJob(d, "build", "nope", "")).toBe(
    "Not changed: schedule needs 5 fields — minute hour day month weekday — but got 1",
  )
})

test("update keeps whatever the line already ran when the goal is not ours to rewrite", async () => {
  // The Python's fallback to `current["command"]` needs both the stored goal and
  // the new one to be empty — and an empty goal is refused two lines earlier, so
  // the branch cannot run. Ported as it stands (FOUND-IN-THE-PYTHON P-17): a
  // marked line whose command is not one of ours can be deleted, never edited.
  const marked = `0 3 * * * /usr/bin/backup.sh --nightly ${MARKER}backup`
  const { d, cron } = deps([marked])
  expect(await updateCronJob(d, "backup", "@weekly", "")).toBe("Not changed: goal is required")
  expect(cron.lines).toEqual([marked])
  // Give it a goal and the line becomes a launch line, timing kept.
  expect(await updateCronJob(d, "backup", "", "back everything up")).toBe(
    "Updated 'backup': 0 3 * * * — the agent will run on 'back everything up'.",
  )
  expect(cron.lines[0]).toBe(`0 3 * * * ${defaultLaunch("backup", "back everything up")} ${MARKER}backup`)
})

test("deleting removes exactly one line and says so", async () => {
  const { d, cron } = deps()
  await createCronJob(d, "build", "@daily", "check the build")
  await createCronJob(d, "tidy", "@daily", "tidy the space")
  expect(await deleteCronJob(d, "build")).toBe("Removed 'build'.")
  expect(cron.lines.length).toBe(1)
  expect(await deleteCronJob(d, "build")).toBe(
    "No job named 'build'. Use list_cron_jobs to see what is scheduled.",
  )
})

// ── the read that failed ─────────────────────────────────────────────────

test("a read that fails writes nothing at all", async () => {
  const kept = [...FOREIGN]
  const fault = (/** @type {string} */ op) => (op === "readLines" ? new Error("permission denied") : null)
  const { d, cron } = deps(kept, fault)
  expect(await listCronJobs(d)).toBe("Could not read the schedule: permission denied")
  expect(await createCronJob(d, "build", "@daily", "go")).toBe("Could not schedule 'build': permission denied")
  expect(await updateCronJob(d, "build", "@weekly", "")).toBe("Could not change 'build': permission denied")
  expect(await deleteCronJob(d, "build")).toBe("Could not remove 'build': permission denied")
  expect(cron.lines).toEqual(kept)
})

test("a write that fails is reported to the model, not raised", async () => {
  const fault = (/** @type {string} */ op) => (op === "writeLines" ? new Error("crontab: installing failed") : null)
  const { d } = deps([], fault)
  expect(await createCronJob(d, "build", "@daily", "go")).toBe("Could not schedule 'build': crontab: installing failed")
})

// ── the model's vocabulary ───────────────────────────────────────────────

test("the tools keep the Python's names, arguments and descriptions", async () => {
  const { d } = deps()
  const tools = cronTools(d)
  expect(tools.map((t) => t.toolName)).toEqual([
    "list_cron_jobs",
    "create_cron_job",
    "update_cron_job",
    "delete_cron_job",
  ])
  expect(tools[1].usageArgs).toBe('{"name": "<name>", "schedule": "<schedule>", "goal": "<goal>"}')
  expect(tools[0].usageArgs).toBe("{}")
  expect(tools[3].description).toBe(
    "Remove one scheduled job by name. Only jobs scheduled through these tools can be removed.",
  )
  expect(await tools[1]({ name: "build", schedule: "@daily", goal: "check the build" })).toBe(
    "Scheduled 'build': @daily — the agent will run on 'check the build'.",
  )
  expect(await tools[0]({})).toBe("build: @daily — check the build")
})
