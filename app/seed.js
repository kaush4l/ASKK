/** First boot — the files the page brings with it.
 *
 *     await seed(ports.fs)
 *
 * OPFS starts empty, and an empty workspace has no main agent, so `loadAgents`
 * would throw before the page ever rendered a thing. These are the files the
 * repository ships, carried into the bundle as text and written down once.
 *
 * **Seeding never overwrites.** After the first boot OPFS is the live store and
 * the user's edits are the truth; a seed that reasserted itself on reload would
 * silently discard an agent someone spent an evening writing, which is the one
 * unforgivable behaviour for a store the user can edit in place. Each path is
 * checked and skipped if anything is already there — including a file the user
 * emptied on purpose.
 *
 * The text arrives through `with { type: "text" }`, which `bun build
 * --target=browser` resolves with no plugin and no runtime dependency. `tsc`
 * has no loader for a `.md`, so each import carries the one suppression this
 * tree allows; the alternative was a second copy of every one of these files
 * pasted into a string literal here, and two copies of a prompt drift.
 *
 * `agents/main/tools.js` is here too, and it is the one file whose copy on disk
 * is not the copy that runs. A browser cannot `import()` an OPFS path, so
 * `app/worker.js` executes the bundled module and this writes the same bytes
 * down beside it — `core/agentfile-tools.js` will not even ask for a tools
 * module unless the fs port says the file is there, and a workspace that claims
 * an agent has four tools should show the source of them. Editing that copy
 * changes nothing until the page is rebuilt; PORT-MAP §3 says so out loud.
 */

// @ts-expect-error bun resolves this as text; tsc has no loader for `.md`
import mainAgent from "../agents/main/agent.md" with { type: "text" };
// tsc resolves a `.json` and types it as the parsed object; bun honours the
// attribute and hands over the bytes. `String()` is what reconciles the two.
import models from "../agents/models.json" with { type: "text" };
// @ts-expect-error bun resolves this as text; tsc has no loader for a `.md`
import summarizer from "../core/agents/summarizer/agent.md" with { type: "text" };
// @ts-expect-error bun resolves this as text; tsc has no loader for a `.md`
import verifier from "../core/agents/verifier/agent.md" with { type: "text" };
// @ts-expect-error bun resolves this as text; tsc has no loader for a `.md`
import critic from "../core/agents/critic/agent.md" with { type: "text" };
// @ts-expect-error bun resolves this as text; tsc has no loader for a `.md`
import summarizeFile from "../skills/summarize-file/SKILL.md" with { type: "text" };
// The same reconciliation as models.json, from the other side: `tsc` resolves
// the `.js` and types this as the module's default export, bun honours the
// attribute and hands over the source bytes. It needs no suppression — the file
// has a default export precisely so this import typechecks.
import mainTools from "../agents/main/tools.js" with { type: "text" };

/** @typedef {import("../core/ports.js").FsPort} FsPort */
/** @typedef {{ path: string, text: string }} SeedFile */

/**
 * Every path this page can create, and the bytes it would put there.
 *
 * The three built-ins keep their `core/agents/` home because that is the
 * directory `core/registry.js` reads them from, and a project agent of the same
 * name in `agents/` replaces one rather than doubling it. That override is a
 * feature of the registry, and it only works if the built-ins land where it
 * looks.
 * @type {readonly SeedFile[]}
 */
export const SEED = Object.freeze([
  { path: "agents/main/agent.md", text: String(mainAgent) },
  { path: "agents/main/tools.js", text: String(mainTools) },
  { path: "agents/models.json", text: String(models) },
  { path: "core/agents/summarizer/agent.md", text: String(summarizer) },
  { path: "core/agents/verifier/agent.md", text: String(verifier) },
  { path: "core/agents/critic/agent.md", text: String(critic) },
  { path: "skills/summarize-file/SKILL.md", text: String(summarizeFile) },
]);

/**
 * Write whatever is not there yet, and report what was written.
 *
 * The return value is the list of paths this call created — empty on every boot
 * after the first, which is what an interface should be able to say out loud
 * rather than guess at.
 * @param {FsPort} fs
 * @param {readonly SeedFile[]} [files]
 * @returns {Promise<string[]>}
 */
export async function seed(fs, files = SEED) {
  /** @type {string[]} */
  const written = [];
  for (const file of files) {
    if (await fs.exists(file.path)) continue;
    await fs.write(file.path, file.text);
    written.push(file.path);
  }
  return written;
}
