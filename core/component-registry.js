/**
 * The registry — the one table that says what a component *name* means.
 *
 * A name is how an agent.md `components:` list asks for a part of the prompt, so
 * this table is the only authority on that mapping. It is also the only mutable
 * thing in the component tier, which is why it is a module of its own rather
 * than a footnote to the classes: the TOOLS and RESPONSE components add
 * themselves to it from their own files, so what it contains depends on what has
 * been imported, and `core/index.js` fixes that import order on purpose
 * (PORT-MAP finding F-3).
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

/**
 * Declarable by name from an agent.md `components` list. The TOOLS and RESPONSE
 * components register themselves here from their own modules — which is why this
 * object stays mutable, and why it is the only authority on what a name means.
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
