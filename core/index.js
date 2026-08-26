/**
 * The core's single entry point — one explicit import, one populated registry.
 *
 * Python's `core/__init__.py` imported every submodule, so by the time anyone
 * held a name from `core` the `COMPONENTS` registry was complete. JavaScript
 * gives no such guarantee: `component-registry.js` declares eight entries and
 * `responses.js` and `tool-prompt.js` each add their own from the bottom of
 * their own file, so whether `COMPONENTS.tools` exists depends on whether
 * anything happened to have imported it yet. PORT-MAP finding F-3 is exactly
 * that hazard — a registry populated by import order is a registry whose
 * contents depend on the shape of an unrelated call graph.
 *
 * So this module imports those three, in that order, on purpose. Import `core`
 * (never a submodule) anywhere the registry has to be whole — `getComponent`,
 * an agent.md `components:` list, the prompt inspector.
 *
 * `__all__` is mirrored, not invented. Names absent here are absent because
 * their module is a later wave (`Agent`, `PHASES`, `Space`, the cron tools,
 * `load_agent`); when those land they are re-exported from here too, and
 * nothing else about this file changes.
 */

// Order matters, and it is a decision rather than a coincidence:
// component-registry.js declares the registry, and the two modules that extend
// it come after.
import "./component-registry.js";
import "./responses.js";
import "./tool-prompt.js";

export { Component, Slot } from "./component-base.js";

export { COMPONENTS, getComponent } from "./component-registry.js";

export {
  ContextBlock,
  CritiqueFindings,
  History,
  LoadedSkills,
  PhaseInstructions,
  SkillCatalog,
  Soul,
  SystemInstructions,
} from "./components.js";

export { AssemblyError, MEMO_LIMIT, PromptAssembler } from "./assembler.js";

export {
  BaseResponse,
  CritiqueResponse,
  PlanResponse,
  ReActResponse,
  RESPONSE_MODELS,
  ResponseContract,
  SimpleResponse,
  SkillSelectResponse,
  UnderstandResponse,
  VerifyResponse,
  getResponseModel,
} from "./responses.js";

export { ARG_ERROR, Toolbox } from "./tools.js";
export { Tool, ToolResult, tool } from "./tool-call.js";
export { initMcpTools } from "./tool-mcp.js";
export { ToolboxComponent } from "./tool-prompt.js";

export {
  AnthropicCompatible,
  Inference,
  KINDS,
  Message,
  Multimodality,
  OpenAICompatible,
  getInference,
  loadModels,
} from "./inference.js";

export { Transcript } from "./memory.js";
export { Critique, Session, Step, StepResult } from "./session.js";
export { Skill, catalog, loadSkills, loaded, select } from "./skills.js";
export { AgentState, State, Status } from "./state.js";
export { FrontmatterError, parseAgentFile } from "./frontmatter.js";

// S9, which the Python had no need of: it owned a filesystem, a clock and
// threads outright, and this build has to be handed all three.
export { defaultPorts, isConfigured } from "./ports.js";
