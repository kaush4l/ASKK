/** The browser cron adapter — `schedule.json` in the fs port, plus a ticker.
 *
 * A page cannot install a system job, so this does not pretend to be a
 * crontab. It is the same `CronPort` — `core/schedule.js` reads and writes
 * lines through it and never learns which store it has — over a file the page
 * owns, plus a ticker that fires a job while the page is open.
 *
 * What the page will not do is catch up. A job whose time passed while the tab
 * was closed is **reported as missed**, never replayed: a user who comes back
 * to eleven queued agent runs was not helped, and a run eleven hours late does
 * the wrong work anyway. Saying so plainly is the difference from a lie.
 */

/**
 * @typedef {import("../ports.js").CronPort} CronPort
 * @typedef {import("../ports.js").FsPort} FsPort
 * @typedef {import("../ports.js").ClockPort} ClockPort
 * @typedef {{ name: string, schedule: string, command: string }} Job
 * @typedef {{ job: Job, since: Date, runs: number }} Missed
 */

const MARKER = "# agent-cron:";

/** The `@shortcuts`, as the five fields each means. `@reboot` fires when the
 *  ticker starts: a page opening is this environment's only boot. */
const SHORTCUTS = {
  "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
};

/** A backfill scan stops here: past a week the count is the answer. */
const SCAN_LIMIT_MINUTES = 7 * 24 * 60;

/**
 * Break up a line the schedule wrote. Anything else gives null — a line
 * without the marker belongs to somebody else and is never ours to fire. Only
 * the marker and the schedule fields are read: the launch command's shape is
 * `core/schedule.js`'s, so it travels whole rather than be guessed at.
 * @param {string} line @returns {Job | null}
 */
export function managedLine(line) {
  const cut = line.indexOf(MARKER);
  if (cut === -1) return null;
  const fields = line.slice(0, cut).split(/\s+/).filter(Boolean);
  const count = fields[0]?.startsWith("@") ? 1 : 5;
  if (fields.length <= count) return null;
  return { name: line.slice(cut + MARKER.length).trim(), schedule: fields.slice(0, count).join(" "), command: fields.slice(count).join(" ") };
}

/** One cron field to the set of values it allows, or null for `*`.
 * @param {string} spec @param {number} min @param {number} max @returns {Set<number> | null} */
function parseField(spec, min, max) {
  if (spec === "*") return null;
  /** @type {Set<number>} */
  const allowed = new Set();
  for (const part of spec.split(",")) {
    const [range, step] = part.split("/");
    const by = step ? Number(step) : 1;
    if (!Number.isInteger(by) || by < 1) return new Set();
    const [lo, hi] = range === "*" ? [min, max] : range.split("-").map(Number);
    const last = hi === undefined ? lo : hi;
    if (!Number.isInteger(lo) || !Number.isInteger(last)) return new Set();
    for (let value = lo; value <= last && value <= max; value += by) if (value >= min) allowed.add(value);
  }
  return allowed;
}

/** @param {string} schedule @returns {(Set<number> | null)[] | null} */
function parseSchedule(schedule) {
  const text = SHORTCUTS[/** @type {keyof typeof SHORTCUTS} */ (schedule)] ?? schedule;
  const fields = text.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return null;
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.map((field, i) => parseField(field, bounds[i][0], bounds[i][1]));
}

/**
 * The five numbers a schedule is matched against, in the clock's own zone —
 * reading the host's zone is the ambient environment the ports exist to remove.
 * @param {Date} date @param {string} zone @returns {number[]}
 */
function fieldsOf(date, zone) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short",
  });
  /** @type {Record<string, string>} */
  const part = {};
  for (const piece of format.formatToParts(date)) part[piece.type] = piece.value;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [Number(part.minute), Number(part.hour), Number(part.day), Number(part.month), days.indexOf(part.weekday ?? "")];
}

/**
 * Does this schedule fire at this moment? Day-of-month and day-of-week are
 * OR-ed when both are restricted and AND-ed otherwise — cron's oldest
 * surprise, and what every crontab on the host already does.
 * @param {string} schedule @param {Date} at @param {string} zone
 */
export function fires(schedule, at, zone) {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;
  const [minute, hour, dom, month, dow] = fieldsOf(at, zone);
  const [mF, hF, domF, monF, dowF] = parsed;
  if (!(mF === null || mF.has(minute))) return false;
  if (!(hF === null || hF.has(hour))) return false;
  if (!(monF === null || monF.has(month))) return false;
  const dayByDate = domF === null || domF.has(dom);
  const dayByWeek = dowF === null || dowF.has(dow) || (dow === 0 && dowF.has(7));
  return domF === null || dowF === null ? dayByDate && dayByWeek : dayByDate || dayByWeek;
}

/** @typedef {{ lines: string[], checked: string }} State */

/** @param {FsPort} fs @param {string} path @returns {Promise<State>} */
async function readState(fs, path) {
  const text = await fs.read(path);
  if (text === null) return { lines: [], checked: "" };
  // A file that exists and cannot be understood must throw, not read as empty:
  // the caller's next move is to write every line back, and it would write
  // over jobs it never saw.
  const loaded = JSON.parse(text);
  if (!loaded || typeof loaded !== "object" || !Array.isArray(loaded.lines)) {
    throw new Error(`${path}: not a schedule file`);
  }
  return { lines: loaded.lines.map(String), checked: String(loaded.checked ?? "") };
}

/** @param {FsPort} fs @param {string} path @param {Partial<State>} change */
async function writeState(fs, path, change) {
  const state = { ...(await readState(fs, path)), ...change };
  await fs.replace(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Every job that fired in the minutes between two instants, folded by name.
 * @param {string[]} lines @param {Date} from @param {Date} to @param {string} zone
 * @returns {Missed[]} */
function between(lines, from, to, zone) {
  const jobs = lines.map(managedLine).filter((job) => job !== null);
  /** @type {Map<string, Missed>} */
  const found = new Map();
  let at = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  for (let scanned = 0; at <= to && scanned < SCAN_LIMIT_MINUTES; scanned++, at = new Date(at.getTime() + 60_000)) {
    for (const job of jobs) {
      if (!fires(job.schedule, at, zone)) continue;
      const seen = found.get(job.name);
      if (seen) seen.runs += 1;
      else found.set(job.name, { job, since: at, runs: 1 });
    }
  }
  return [...found.values()];
}

/**
 * One wake. The file is re-read every time: a job scheduled a minute ago
 * through the same port must fire, and a list captured at start never sees it.
 * @param {FsPort} fs @param {string} path @param {ClockPort} clock
 * @param {((job: Job) => void) | undefined} run
 */
async function tick(fs, path, clock, run) {
  const state = await readState(fs, path);
  const now = clock.now();
  const from = state.checked ? new Date(state.checked) : now;
  for (const due of between(state.lines, from, now, clock.zone())) {
    for (let i = 0; i < due.runs; i++) run?.(due.job);
  }
  await writeState(fs, path, { checked: now.toISOString() });
}

/**
 * A `CronPort` over a JSON file, with the ticker that makes it mean anything.
 *
 * @param {object} options
 * @param {FsPort} options.fs @param {ClockPort} options.clock
 * @param {string} [options.path] @param {number} [options.everyMs]
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @returns {CronPort & { start(handlers: { run?: (job: Job) => void, onMissed?: (missed: Missed[]) => void }): Promise<() => void> }}
 */
export function cronBrowser(options) {
  const { fs, clock, path = "agents/schedule.json", everyMs = 60_000 } = options;
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle));
  return {
    readLines: async () => (await readState(fs, path)).lines,
    writeLines: async (lines) => writeState(fs, path, { lines }),
    async start({ run, onMissed }) {
      const state = await readState(fs, path);
      const opened = clock.now();
      // Reported, never replayed, and reported before the first tick so a
      // caller learns what it missed before anything new fires.
      if (state.checked) onMissed?.(between(state.lines, new Date(state.checked), opened, clock.zone()));
      for (const job of state.lines.map(managedLine)) if (job?.schedule === "@reboot") run?.(job);
      await writeState(fs, path, { checked: opened.toISOString() });
      const handle = setTimer(() => void tick(fs, path, clock, run), everyMs);
      return () => clearTimer(handle);
    },
  };
}
