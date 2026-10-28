// The job index of a generator (audiogen.js, imagegen.js): <dir>/index.json, a list of jobs, newest first. `label` heads
// its log lines ("audio", "images").
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

// The saved jobs; an index that does not read is moved aside, and a job the server stopped under comes back
// interrupted, never "running" forever.
export function loadJobIndex(index, label, log) {
  let jobs = []
  try {
    jobs = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : []
    if (!Array.isArray(jobs)) throw new Error("not a list")
  } catch (error) {
    const aside = `${index}.unreadable-${Date.now()}`
    renameSync(index, aside)
    log(`${label}: ${index} unreadable (${error.message}) — moved to ${aside}`)
    jobs = []
  }
  let woke = 0
  jobs = jobs.map((j) => (["running", "queued"].includes(j.status) ? (woke++, { ...j, status: "interrupted", error: "the desk server stopped while it waited or ran" }) : j))
  if (woke) log(`${label}: ${woke} job${woke === 1 ? "" : "s"} interrupted by the last stop`)
  return jobs
}

export function saveJobIndex(index, jobs, label, log) {
  try {
    writeFileSync(`${index}.tmp`, JSON.stringify(jobs))
    renameSync(`${index}.tmp`, index)
  } catch (error) {
    log(`${label}: index not saved: ${error.message}`)
  }
}
