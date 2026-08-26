/**
 * The registry — the one table that says what a component *name* means.
 *
 * A name is how an agent.md `components:` list asks for a part of the prompt, so
 * this table is the only authority on that mapping, and it is complete the
 * moment this module has finished evaluating. That is the whole point of the
 * layering: `component-base.js` defines what a component is, the four modules
 * below define the ten concrete ones, and this module — which nothing beneath it
 * imports — names them. Importing four modules instead of two is not a cycle;
 * a concrete component reaching *up* for `COMPONENTS` would be, which is why
 * none of them do any more (PORT-MAP finding F-3).
 */

import { Component } from "./component-base.js";
import {
  ContextBlock,
  CritiqueFindings,
  History,
  LoadedSkills,
  PhaseInstructions,
  SkillCatalog,
  Soul,
  SystemInstructions,
} from "./components.js";
import { ResponseContract } from "./responses.js";
import { ToolboxComponent } from "./tool-prompt.js";

/**
 * Declarable by name from an agent.md `components` list — all ten, declared
 * here. The Python appended TOOLS and RESPONSE from the bottom of their own
 * modules, so what the table held depended on what an unrelated call graph
 * happened to have imported; the key order below is the order that produced,
 * kept because `getComponent`'s error text lists the keys.
 *
 * Still a plain mutable object: a test, and the prompt inspector, add a
 * component by name, and that is the one extension point the tier allows.
 * @type {Record<string, typeof Component>}
 */
export const COMPONENTS = {
  soul: Soul,
  system: SystemInstructions,
  context: ContextBlock,
  history: History,
  phase: PhaseInstructions,
  critique_findings: CritiqueFindings,
  skill_catalog: SkillCatalog,
  loaded_skills: LoadedSkills,
  response: ResponseContract,
  tools: ToolboxComponent,
};

/**
 * @param {string} name
 * @returns {typeof Component}
 */
export function getComponent(name) {
  const found = COMPONENTS[name];
  if (!found) throw new Error(`Unknown component '${name}'. Known: ${Object.keys(COMPONENTS).join(", ")}`);
  return found;
}
