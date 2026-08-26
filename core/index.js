/**
 * The core's single entry point — every name the core offers, in one import.
 *
 * Python's `core/__init__.py` imported every submodule, so by the time anyone
 * held a name from `core` the `COMPONENTS` registry was complete. This build
 * does not lean on that: `component-registry.js` declares all ten components
 * itself, so the registry is whole the moment it is imported, from wherever it
 * is imported. PORT-MAP finding F-3 — a registry populated by import order is a
 * registry whose contents depend on the shape of an unrelated call graph — is
 * fixed at the registry rather than papered over here.
 *
 * `__all__` is mirrored, not invented. Two names in the Python's list have no
 * counterpart in this tree and never will: `ClaudeCLI` (a subprocess) and
 * `STATE` (a module-global the browser build hands in as a port instead).
 */

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

export { Agent } from "./agent.js";
export { PHASES, Phase } from "./phases.js";
export { FLOWS, getFlow } from "./flows.js";
export { SPACES_DIR, Space, getSpace } from "./space.js";
export { createCronJob, deleteCronJob, listCronJobs, updateCronJob } from "./schedule.js";
export { agentMetadata, loadAgent, loadTools } from "./agentfile.js";
export { WorkerAgent, loadAgents } from "./registry.js";

// S9, which the Python had no need of: it owned a filesystem, a clock and
// threads outright, and this build has to be handed all three.
export { defaultPorts, isConfigured } from "./ports.js";
