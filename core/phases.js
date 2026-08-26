/** Phases — the stages a single long-running agent moves through.
 *
 * A phase is a recipe plus a step of control flow: it says which components join
 * the prompt, which response contract the model answers in, and — from what came
 * back — what happened. The history and the session are shared across all of
 * them; a phase only ever swaps the parts of the prompt that belong to it. The
 * graph those outcomes move through is drawn in `core/flows.js`, which is where
 * PORT-MAP R2 put it: `run` returns the **outcome** it reached, never the name of
 * the next phase, so an edge is data and a typo is a load error rather than a
 * silent stop forty turns in. The prompts are in `core/phase-prompts.js`.
 *
 * Meta phases (understand, select_skills, plan, verify, critique) do not write
 * their turns into the transcript — they pass `record: false`, their output lands
 * on the session, and components render it back into later prompts. Only the
 * phases that talk to the user or do the work (react, work, respond) leave
 * conversation turns behind: a planner's musings are not conversation.
 *
 * An adversarial reviewer that read the worker's own reasoning tends to agree
 * with it, which is why verify and critique run on fresh-context sub-agents
 * (`agent.consult`) that see the session's artifacts and never the transcript.
 */

import { CritiqueFindings, PhaseInstructions } from "./components.js";
import { CRITIQUE_PROMPT, PLAN_PROMPT, RESPOND_CAVEATS, RESPOND_PROMPT, SELECT_PROMPT, UNDERSTAND_PROMPT, VERIFY_PROMPT, WORK_PROMPT, fill, outcomesText, planText } from "./phase-prompts.js";
import { CritiqueResponse, PlanResponse, SimpleResponse, SkillSelectResponse, UnderstandResponse, VerifyResponse } from "./responses.js";
import { Critique, DONE, Step, StepResult } from "./session.js";
import { catalog, loadSkills, select } from "./skills.js";

/** @typedef {import("./component-base.js").Component} Component */
/** @typedef {import("./session.js").Session} Session */
/** What a phase needs of the agent running it — the Python's `if TYPE_CHECKING:
 * from .agent import Agent`, spelled out. It is also the whole of what a phase
 * may touch: `core/agent.js` satisfies it and nothing here reaches past it.
 * @typedef {{
 *   name: string, maxRounds: number, skillsDir: string, verifier: any, critic: any,
 *   ports: { fs: import("./ports.js").FsPort },
 *   log: { info(m: string): void, warning(m: string): void },
 *   turn(components?: Component[] | null, model?: any, tools?: boolean, record?: boolean): Promise<any>,
 *   reactLoop(components?: Component[] | null): Promise<any>,
 *   consult(reviewer: any, prompt: string): Promise<string>,
 * }} AgentLike */

/** The agent's log, narrowed to the one method `skills.js` takes. Without it that file's
 * three warnings are unreachable, which is the same as deleted. @param {AgentLike} agent */
const warnings = (agent) => ({ warn: (/** @type {string} */ m) => agent.log.warning(m) });

/** This phase's own instructions, filled in. @param {string} t @param {Record<string, string | number>} v */
const say = (t, v) => new PhaseInstructions({ body: fill(t, v) });
/** A parsed response's list field, as strings. @param {any} parsed @param {string} name @returns {string[]} */
const listOf = (parsed, name) =>
  (Array.isArray(parsed.value(name)) ? parsed.value(name) : []).map((/** @type {unknown} */ i) => String(i));

/** One stage. `run` does its turns and names the outcome it reached; `OUTCOMES` declares
 * every name it can return, and `core/flows.js` needs an edge for each. */
export class Phase { static OUTCOMES = /** @type {readonly string[]} */ ([]); name = ""; }

/** First contact with the query: gauge complexity, sharpen the wording. */
export class UnderstandPhase extends Phase {
  static OUTCOMES = ["simple", "complex"]; name = "understand";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const asked = [say(UNDERSTAND_PROMPT, { query: session.query })];
    const parsed = await agent.turn(asked, UnderstandResponse, false, false); // record: false
    session.complexity = /** @type {"simple" | "complex"} */ (String(parsed.value("complexity")));
    session.enhanced = String(parsed.value("enhanced_query")).trim();
    agent.log.info(`${agent.name}: query judged ${session.complexity}`);
    return session.complexity === "simple" ? "simple" : "complex";
  }
}

/** One call over the catalogue. No skills on disk means no call at all. */
export class SelectSkillsPhase extends Phase {
  static OUTCOMES = ["done"]; name = "select_skills";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const available = await loadSkills(agent.ports.fs, agent.skillsDir, warnings(agent));
    if (available.length === 0) return "done";
    const asked = [catalog(available), say(SELECT_PROMPT, { goal: session.goal })];
    const parsed = await agent.turn(asked, SkillSelectResponse, false, false);
    session.skills = select(available, listOf(parsed, "skills"), warnings(agent));
    const names = session.skills.map((s) => /** @type {{ name: string }} */ (s).name).join(", ");
    if (names) agent.log.info(`${agent.name}: loaded skills: ${names}`);
    return "done";
  }
}

/** Lay out the steps. On a revision round the critic's findings are in the prompt. */
export class PlanPhase extends Phase {
  static OUTCOMES = ["done"]; name = "plan";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const findings = new CritiqueFindings({ findings: session.unresolved.map((c) => c.finding) });
    const asked = [say(PLAN_PROMPT, { goal: session.goal }), findings];
    const parsed = await agent.turn(asked, PlanResponse, false, false);
    const written = listOf(parsed, "steps").map((s) => s.trim()).filter(Boolean);
    // a plan with no steps is a planner failure, not an empty task
    session.plan = (written.length > 0 ? written : [session.goal]).map((d) => new Step({ description: d }));
    session.stepResults.length = 0;
    // This plan is the answer to the findings it was shown; they are now spent.
    for (const critique of session.unresolved) critique.resolved = true;
    return "done";
  }
}

/** Do the steps, in order, each as its own ReAct loop, checking each one off. */
export class WorkPhase extends Phase {
  static OUTCOMES = ["done"]; name = "work";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    let number = 0;
    for (const step of session.plan) {
      number += 1;
      if (step.status === DONE) continue;
      const brief = { goal: session.goal, plan: planText(session), number, step: step.description };
      const parsed = await agent.reactLoop([say(WORK_PROMPT, brief)]);
      const answer = parsed && typeof parsed === "object" && "answer" in parsed ? parsed.answer : parsed;
      session.stepResults.push(new StepResult({ step: step.description, outcome: String(answer).trim() }));
      step.status = DONE;
    }
    return "done";
  }
}

/** A fresh-context reviewer checks the work against the task. */
export class VerifyPhase extends Phase {
  static OUTCOMES = ["pass", "retry", "exhausted"]; name = "verify";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const brief = { goal: session.goal, plan: planText(session), outcomes: outcomesText(session) };
    const report = await agent.consult(agent.verifier, fill(VERIFY_PROMPT, brief));
    const parsed = VerifyResponse.parse(report);
    if (parsed.value("verdict") === "pass") {
      session.verifyReport = report;
      return "pass";
    }
    if (session.round >= agent.maxRounds) {
      agent.log.warning(`${agent.name}: verify failed and rounds are exhausted`);
      return "exhausted";
    }
    session.round += 1;
    session.critiques.push(new Critique({ finding: `verifier: ${parsed.value("evidence") || report}`, severity: "blocking" }));
    return "retry"; // The failed steps are worked again from a fresh plan.
  }
}

/** The bar-raiser. Blocking findings send the plan back up; a cap ends the loop. */
export class CritiquePhase extends Phase {
  static OUTCOMES = ["done", "retry", "exhausted"]; name = "critique";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const brief = { goal: session.goal, plan: planText(session), outcomes: outcomesText(session), verify: session.verifyReport };
    const report = await agent.consult(agent.critic, fill(CRITIQUE_PROMPT, brief));
    const parsed = CritiqueResponse.parse(report);
    /** @type {Critique[]} */ const blocking = [];
    for (const item of listOf(parsed, "findings")) {
      const text = item.trim();
      const severity = text.toLowerCase().startsWith("blocking") ? "blocking" : "minor";
      const colon = text.indexOf(":");
      const critique = new Critique({ finding: colon < 0 ? text : text.slice(colon + 1).trim(), severity });
      session.critiques.push(critique);
      if (severity === "blocking") blocking.push(critique);
    }
    if (parsed.value("verdict") === "approve" || blocking.length === 0) return "done";
    if (session.round >= agent.maxRounds) {
      agent.log.warning(`${agent.name}: critique still blocking and rounds are exhausted`);
      return "exhausted";
    }
    session.round += 1;
    return "retry";
  }
}

/** Compose the user-facing reply — including, honestly, anything left unresolved. */
export class RespondPhase extends Phase {
  static OUTCOMES = ["done"]; name = "respond";
  /** @param {AgentLike} agent @param {Session} session @returns {Promise<string>} */
  async run(agent, session) {
    const findings = session.unresolved.map((c) => `- ${c.finding}`).join("\n");
    const caveats = findings ? fill(RESPOND_CAVEATS, { findings }) : "";
    const brief = { goal: session.goal, outcomes: outcomesText(session), caveats };
    // The one phase here that records: this reply *is* the conversation.
    await agent.turn([say(RESPOND_PROMPT, brief)], SimpleResponse, false, true);
    return "done";
  }
}

/** The classic loop — think, act, observe, until the model answers. */
export class ReActPhase extends Phase {
  static OUTCOMES = ["done"]; name = "react";
  /** @param {AgentLike} agent @param {Session} _session @returns {Promise<string>} */
  async run(agent, _session) {
    await agent.reactLoop([]);
    return "done";
  }
}

/** @type {Record<string, Phase & { run(a: AgentLike, s: Session): Promise<string> }>} */
export const PHASES = Object.fromEntries(
  [new UnderstandPhase(), new SelectSkillsPhase(), new PlanPhase(), new WorkPhase(), new VerifyPhase(), new CritiquePhase(), new RespondPhase(), new ReActPhase()].map((p) => [p.name, p]),
);
