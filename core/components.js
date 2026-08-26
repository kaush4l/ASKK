/**
 * The eight components the core declares — one class per part of a prompt that
 * this module owns: the soul, the system block, the context facts, the
 * transcript, the phase instructions, the unresolved critique findings, the
 * skill catalogue and the loaded skill bodies. The two remaining components ship
 * with the modules that own them (`tools.js`, `responses.js`).
 *
 * What a component *is* — the render/key/applies/SLOT contract, the
 * immutability, the compiled template — lives in `component-base.js`; this file
 * is only instances of that abstraction. The name each one is declarable by
 * lives in `component-registry.js`.
 */

import { Component, Slot, hash } from "./component-base.js";

/** @typedef {import("./component-base.js").ComponentInit} ComponentInit */

/** Who the agent is. Distinct from SystemInstructions so a phase can never displace it. */
export class Soul extends Component {
  // Annotated, not inferred: SystemInstructions overrides both, and a literal
  // type on a base static makes the subclass a type error rather than a slot.
  /** @type {number} */ static SLOT = Slot.SOUL;
  static TEMPLATE = "{{ text }}\n\n";
  static FIELDS = ["priority", "text"];
  /** @type {string} */ static NAME = "Soul";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {string} */
    this.text = (data.text ?? "").trim();
    Object.freeze(this);
  }
  applies() {
    return Boolean(this.text);
  }
}

/** The system block — same shape as Soul, one slot later. */
export class SystemInstructions extends Soul {
  static SLOT = Slot.SYSTEM;
  static NAME = "SystemInstructions";
}

/**
 * Facts about right now: the clock, and whatever the space knows.
 *
 * Never cached — the whole point of this block is that it is different every
 * render. A value that starts on its own line is already indented under its key;
 * anything else sits after `key: ` (the old engine's exact rule).
 */
export class ContextBlock extends Component {
  static SLOT = Slot.CONTEXT;
  static CACHEABLE = false;
  static TEMPLATE = "{% if lines %}## CONTEXT\n\n{{ lines | join('\n') }}\n\n{% endif %}";
  static FIELDS = ["priority", "facts"];
  static NAME = "ContextBlock";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    // A plain object like the Python dict: fact keys are words, and JS fixes
    // insertion order for every key that is not an array index.
    /** @type {Record<string, string>} */
    this.facts = Object.freeze({ ...(data.facts ?? {}) });
    Object.freeze(this);
  }
  templateData() {
    const lines = Object.entries(this.facts)
      .filter(([, v]) => v)
      .map(([k, v]) => (v.startsWith("\n") ? `${k}:${v}` : `${k}: ${v}`));
    return { lines };
  }
  applies() {
    return Object.values(this.facts).some((v) => Boolean(v));
  }
}

/** The transcript — already-formatted `[ROLE]: content` lines. */
export class History extends Component {
  static SLOT = Slot.HISTORY;
  static TEMPLATE = "{% if lines %}{{ lines | join('\n\n') }}\n\n{% endif %}";
  static FIELDS = ["priority", "lines"];
  static NAME = "History";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {readonly string[]} */
    this.lines = Object.freeze([...(data.lines ?? [])]);
    Object.freeze(this);
  }
  key() {
    // The generic key serializes every field, and this component carries the
    // whole transcript — hashing the lines behind their count keeps a long
    // conversation's render cost flat instead of growing with the JSON. The
    // separator is a NUL because a space would let two different splits of the
    // same words hash alike, and a cache key that collides serves wrong bytes.
    return `History:${this.lines.length}:${hash(this.lines.join("\u0000"))}`;
  }
  applies() {
    return this.lines.length > 0;
  }
}

/** What the current phase asks of the model — swapped every phase. */
export class PhaseInstructions extends Component {
  static SLOT = Slot.PHASE;
  static TEMPLATE = "{% if body %}## {{ title }}\n\n{{ body }}\n\n{% endif %}";
  static FIELDS = ["priority", "title", "body"];
  static NAME = "PhaseInstructions";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {string} */
    this.title = data.title ?? "CURRENT PHASE";
    /** @type {string} */
    this.body = (data.body ?? "").trim();
    Object.freeze(this);
  }
  applies() {
    return Boolean(this.body);
  }
}

/** Unresolved critique findings, shown to the planner on a revision round. */
export class CritiqueFindings extends Component {
  static SLOT = Slot.PHASE;
  static TEMPLATE =
    "{% if findings %}## UNRESOLVED FINDINGS\n\n" +
    "A reviewer raised these against the previous plan. Address every one.\n\n" +
    "{% for f in findings %}- {{ f }}\n{% endfor %}\n{% endif %}";
  static FIELDS = ["priority", "findings"];
  static NAME = "CritiqueFindings";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super({ ...data, priority: data.priority ?? 10 }); // after the phase's own instructions
    /** @type {readonly string[]} */
    this.findings = Object.freeze([...(data.findings ?? [])]);
    Object.freeze(this);
  }
  applies() {
    return this.findings.length > 0;
  }
}

/** Name + description per available skill — the selector phase's menu. */
export class SkillCatalog extends Component {
  static SLOT = Slot.SKILLS;
  static TEMPLATE =
    "{% if entries %}## AVAILABLE SKILLS\n\n" +
    "{% for name, description in entries %}- {{ name }}: {{ description }}\n{% endfor %}\n{% endif %}";
  static FIELDS = ["priority", "entries"];
  static NAME = "SkillCatalog";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {readonly (readonly [string, string])[]} */
    this.entries = Object.freeze(
      (data.entries ?? []).map((p) => Object.freeze(/** @type {readonly [string, string]} */ ([p[0], p[1]]))),
    );
    Object.freeze(this);
  }
  applies() {
    return this.entries.length > 0;
  }
}

/** The chosen skills' full bodies, present in every phase after selection. */
export class LoadedSkills extends Component {
  static SLOT = Slot.SKILLS;
  static TEMPLATE = "{% if bodies %}## LOADED SKILLS\n\n{% for body in bodies %}{{ body }}\n\n{% endfor %}{% endif %}";
  static FIELDS = ["priority", "bodies"];
  static NAME = "LoadedSkills";
  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {readonly string[]} */
    this.bodies = Object.freeze([...(data.bodies ?? [])]);
    Object.freeze(this);
  }
  applies() {
    return this.bodies.length > 0;
  }
}
