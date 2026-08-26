/**
 * The TOOLS slot — a toolbox as prompt bytes.
 *
 * Its own file because it is the only part of the tool path the *model* reads
 * directly: everything else here is dispatch, and this is text. Editing it is
 * editing the prompt, which `tests/golden/` holds to the byte.
 */

import { Component, Slot } from "./component-base.js";
import { COMPONENTS } from "./component-registry.js";

/** TOOLS-slot component: one usage line per tool, plus the batching rules.
 * The template's output is byte-identical to the old engine's `_tools_block` —
 * see `tests/golden/` for the recorded prompts that hold it to that. */
export class ToolboxComponent extends Component {
  static SLOT = Slot.TOOLS;
  static TEMPLATE =
    "{% if usages %}## AVAILABLE TOOLS\n\n" +
    "{{ usages | join('\n') }}\n\n" +
    "Call them exactly as written above. Calls that do not depend on each other go on " +
    "one line, separated by commas, and run at the same time. A call that needs an earlier " +
    "call's result goes on its own line — lines run in order, top to bottom. Results come " +
    "back labelled with the tool name, in the order you wrote the calls.\n\n{% endif %}";
  static FIELDS = ["priority", "usages"];
  static NAME = "ToolboxComponent";

  /** @param {{ priority?: number, usages?: readonly string[] }} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {readonly string[]} */
    this.usages = Object.freeze([...(data.usages ?? [])]);
    Object.freeze(this);
  }

  /** @returns {boolean} */
  applies() {
    return this.usages.length > 0;
  }
}

COMPONENTS["tools"] = ToolboxComponent;
