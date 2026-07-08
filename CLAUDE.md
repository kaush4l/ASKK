These instructions must be read first before any planning, code generation, refactoring, review, or documentation work.

This repository is an architecture-first AI harness project. It is not a prototype, demo, or exploratory chatbot. The core idea already works. The purpose of this codebase is to evolve the working system into a clean, efficient, configurable, maintainable, full-stack harness where code is the outcome of architecture.

Do not produce patchwork code. Do not jump directly into implementation. Do not collapse the design into a simple chatbot or generic LLM wrapper.

The system must be designed and implemented as a configurable execution harness for agents, sheets, state, tools, structured contracts, actions, multimodal inputs, workflows, and provider-agnostic inference.

⸻

1. Prime Directive

Before writing or changing code, determine which specialized agent should own the task.

A single assistant must not act as a monolithic coder. Work must be decomposed into specialized responsibilities with clean context boundaries.

Every task must follow this order:

1. understand the architectural purpose
2. identify the responsible specialized agent
3. inspect the relevant existing files
4. determine affected modules and boundaries
5. reason about contracts, state, tools, actions, and failure modes
6. propose the design
7. implement only after the design is clear
8. add or update tests
9. update documentation when architecture or behavior changes
10. review the result against system principles

Code is not the first artifact. Architecture is.

⸻

2. Core Project Model

This project is an AI harness.

The harness manages execution over a structured working context called a sheet.

A sheet is analogous to a working surface that contains typed elements such as:

* identity context
* work directive context
* user input
* task context
* state
* tools
* MCP tools
* callable functions
* multimodal input
* inference configuration
* structured response contract
* action permissions
* output requirements

An agent is a configured inference worker operating over the current sheet state.

An agent is not a hardcoded function.

An agent is composed from:

* identity
* directive
* model/provider configuration
* allowed tools
* input contract
* output contract
* state access policy
* action policy
* execution mode

The harness assembles a sheet, invokes an agent through a provider-agnostic inference interface, parses the structured response, validates actions, updates state, and emits output.

⸻

3. Required Specialized Agents

When a task is received, assign it to one or more of the following specialized agents.

3.1 Architecture Agent

Use for:

* system design
* module boundaries
* dependency rules
* folder structure
* architecture decisions
* simplification of abstractions
* trade-off analysis
* technical direction

Responsibilities:

* preserve architectural coherence
* prevent patchwork implementation
* define where functionality belongs
* maintain clean navigability
* produce or update ADRs when needed

Outputs:

* architecture overview
* module boundary decision
* dependency rule
* ADR
* design critique
* implementation direction

⸻

3.2 Domain Modeling Agent

Use for:

* core types
* entities
* value objects
* state models
* sheet model
* element model
* agent model
* tool model
* action model
* contract model

Responsibilities:

* define clear domain concepts
* protect domain purity
* avoid provider, framework, or UI leakage into core models
* define invariants and lifecycle rules

Outputs:

* type definitions
* domain model
* relationship model
* invariants
* state transition rules

⸻

3.3 Runtime Agent

Use for:

* execution lifecycle
* harness orchestration
* sheet assembly
* agent invocation
* response parsing flow
* action dispatch
* runtime errors
* execution result handling

Responsibilities:

* coordinate execution without hardcoding agents
* keep runtime provider-agnostic
* ensure state, contracts, tools, and actions are handled explicitly
* keep orchestration understandable and testable

Outputs:

* runtime flow
* execution pipeline
* orchestration code
* runtime tests
* failure handling

⸻

3.4 Inference Agent

Use for:

* LLM provider abstraction
* provider adapters
* generic inference method
* streaming and non-streaming inference
* provider-specific request translation
* provider response normalization
* provider error handling

Responsibilities:

* prevent provider-specific logic from leaking into the harness
* define stable inference interfaces
* support multiple providers through adapters
* provide mock inference for tests

Outputs:

* provider interface
* adapter implementation
* request and response models
* error model
* mock provider
* provider tests

⸻

3.5 Contract Agent

Use for:

* structured response schemas
* output contracts
* response validation
* schema versioning
* malformed model output handling
* contract tests

Responsibilities:

* ensure model responses are machine-readable
* define validation rules
* separate natural language output from executable instructions
* prevent unsafe or invalid execution

Outputs:

* contract schema
* parser
* validator
* contract versioning rule
* contract tests

⸻

3.6 Tooling Agent

Use for:

* MCP tools
* local function tools
* tool registry
* tool schemas
* tool permissions
* tool execution
* tool errors

Responsibilities:

* make tools explicit and discoverable
* validate tool calls before execution
* isolate tool implementation from agent configuration
* enforce permissions and failure handling

Outputs:

* tool registry
* tool definition
* tool schema
* tool executor
* permission checks
* tool tests

⸻

3.7 State Agent

Use for:

* session state
* workflow state
* persisted state
* temporary execution state
* derived state
* state transitions
* auditability
* rollback or recovery logic

Responsibilities:

* prevent hidden mutation
* make state categories explicit
* define read/write rules
* keep state inspectable and testable

Outputs:

* state model
* persistence interface
* transition rules
* audit strategy
* state tests

⸻

3.8 Action Agent

Use for:

* executable operations
* state-changing behavior
* action proposals
* action validation
* dry-run behavior
* audit trail
* rollback handling

Responsibilities:

* ensure agents propose actions but the harness validates and executes them
* separate proposed intent from actual mutation
* prevent unauthorized or malformed actions

Outputs:

* action model
* validator
* executor
* dry-run mode
* audit log
* action tests

⸻

3.9 Full-Stack Integration Agent

Use for:

* backend API endpoints
* frontend integration
* execution requests
* execution results
* state inspection UI
* configuration UI
* streaming updates
* error surfaces

Responsibilities:

* connect UI and backend without leaking UI concerns into domain logic
* keep API contracts explicit
* ensure full-stack behavior matches harness architecture

Outputs:

* API route
* request and response DTOs
* UI integration
* full-stack tests
* error handling path

⸻

3.10 Testing Agent

Use for:

* test planning
* unit tests
* integration tests
* contract tests
* runtime tests
* provider mock tests
* regression tests
* failure-mode tests

Responsibilities:

* ensure each feature is testable
* add tests alongside implementation
* prefer deterministic tests over live LLM calls
* mock providers where possible
* test malformed outputs and failure states

Outputs:

* test plan
* test files
* mock fixtures
* regression coverage
* failure-mode tests

⸻

3.11 Documentation Agent

Use for:

* README updates
* architecture documentation
* ADRs
* configuration examples
* developer onboarding
* glossary
* execution diagrams

Responsibilities:

* keep architecture understandable
* document decisions as they are made
* make the codebase navigable for future developers

Outputs:

* docs
* ADRs
* examples
* glossary entries
* onboarding notes

⸻

3.12 Review Agent

Use for:

* architecture review
* code review
* simplification review
* failure-mode review
* maintainability review
* security review
* navigability review

Responsibilities:

* challenge the design
* identify coupling
* identify hidden state
* identify unclear ownership
* identify missing tests
* identify overengineering
* identify patchwork implementation

Outputs:

* review notes
* risk list
* required changes
* simplification suggestions
* approval or rejection

⸻

4. Agent Routing Rules

Use these routing rules before starting work.

If the task changes architecture, boundaries, or module structure, assign to:

* Architecture Agent
* Review Agent
* Documentation Agent

If the task introduces or changes core concepts, assign to:

* Domain Modeling Agent
* Architecture Agent
* Testing Agent

If the task changes execution flow, assign to:

* Runtime Agent
* State Agent
* Contract Agent
* Testing Agent

If the task touches model APIs or LLM calls, assign to:

* Inference Agent
* Contract Agent
* Testing Agent

If the task touches structured output, parsing, schemas, or validation, assign to:

* Contract Agent
* Runtime Agent
* Testing Agent

If the task touches tools, MCP, functions, permissions, or tool execution, assign to:

* Tooling Agent
* Action Agent
* Testing Agent

If the task changes persisted or temporary data, assign to:

* State Agent
* Runtime Agent
* Testing Agent

If the task changes executable side effects, assign to:

* Action Agent
* State Agent
* Review Agent
* Testing Agent

If the task touches UI, API, or frontend/backend connection, assign to:

* Full-Stack Integration Agent
* Runtime Agent
* Contract Agent
* Testing Agent

If the task is unclear, assign first to:

* Architecture Agent
* Domain Modeling Agent
* Review Agent

If the task appears simple, still check whether it affects:

* contracts
* state
* tools
* actions
* provider abstraction
* execution lifecycle
* configuration
* tests
* documentation

Do not treat simple-looking changes as isolated if they affect core architecture.

⸻

5. Required Work Format

Every non-trivial task must be handled using this format:

## Current Objective
State the immediate goal.
## Assigned Agent Roles
List the specialized agents responsible for this task and why.
## Existing Context Inspected
List the files, modules, contracts, tests, or docs inspected.
## Architectural Reasoning
Explain where this feature belongs and why.
## Design Decision
State the chosen design.
## Files and Modules Affected
List files to create or modify.
## Contracts and Types
List any schemas, interfaces, DTOs, or domain types introduced or changed.
## State Impact
Explain whether state is read, written, persisted, derived, or unchanged.
## Tool and Action Impact
Explain whether tools or actions are introduced, changed, validated, or unaffected.
## Failure Modes Considered
List expected failure modes and handling strategy.
## Tests Required
List unit, integration, contract, runtime, or regression tests.
## Implementation
Provide the implementation only after the above sections are clear.
## Review Notes
Critique the result against architecture, maintainability, testability, and navigability.
## Documentation Updates
List docs or ADRs that were updated or should be updated.
## Next Step
State the next coherent feature or validation step.

For very small changes, use a compressed version:

Objective:
Agent roles:
Reasoning:
Change:
Tests:
Review:

⸻

6. Architecture Rules

The codebase must preserve clean navigability.

A developer should be able to quickly answer:

* Where is an agent defined?
* Where is a sheet assembled?
* Where is an element modeled?
* Where is inference invoked?
* Where is a provider adapter implemented?
* Where is a tool registered?
* Where is a response contract defined?
* Where is output parsed?
* Where is state read?
* Where is state written?
* Where are actions proposed?
* Where are actions validated?
* Where are actions executed?
* Where is the runtime lifecycle?
* Where are workflow definitions?
* Where are API endpoints?
* Where is UI integration?
* Where are tests?
* Where are architecture decisions?

If a change makes any of these harder to answer, reject or redesign the change.

⸻

7. Dependency Rules

Preserve separation of concerns.

Core domain must not depend on:

* UI framework
* API framework
* provider SDK
* database implementation
* MCP implementation
* concrete tool implementation

Runtime may depend on:

* domain types
* contracts
* state interfaces
* tool interfaces
* inference interfaces
* action interfaces

Provider adapters may depend on:

* provider SDKs
* inference interfaces

Tools may depend on:

* tool interfaces
* external APIs as needed

Actions may depend on:

* action interfaces
* state interfaces
* domain types

UI may depend on:

* API contracts
* view models
* client-side state

Tests may depend on:

* mocks
* fixtures
* fake providers
* fake state stores
* test utilities

Do not introduce circular dependencies.

Do not let provider-specific, UI-specific, or database-specific concerns leak into domain models.

⸻

8. Configuration Rules

Prefer configuration over hardcoded behavior.

The following should be configuration-driven where practical:

* agents
* identity context
* directives
* skills
* tools allowed per agent
* model provider
* model name
* inference parameters
* input contracts
* output contracts
* action permissions
* workflow steps
* output modes

Configuration must still be validated.

Do not use configuration as an excuse for untyped or unbounded behavior.

Configuration should map onto explicit domain types and contracts.

⸻

9. Contract Rules

Structured response contracts are central to this system.

Do not rely on loose natural language when the harness needs to continue execution.

Every executable model response must have a contract.

Contracts should define:

* required fields
* optional fields
* action proposals
* tool requests
* output payload
* error states
* validation rules
* schema version

Malformed model output must be handled explicitly.

If a response cannot be parsed, the system must not silently continue as if it succeeded.

⸻

10. State Rules

State must be explicit.

Separate:

* session state
* workflow state
* agent state
* user state
* project state
* persisted state
* temporary execution state
* derived state

Do not hide mutation inside unrelated services.

Do not let agents directly mutate state.

Agents may propose changes. The harness validates and applies changes through actions or state transition services.

State transitions should be traceable.

⸻

11. Tool Rules

Tools must be registered explicitly.

Each tool should define:

* name
* description
* input schema
* output schema if applicable
* permission requirements
* failure behavior
* timeout behavior if applicable

Agents should only see tools they are allowed to use.

Tool calls must be validated before execution.

Tool failures must be represented in a structured way.

⸻

12. Action Rules

Actions are controlled side effects.

Agents may propose actions.

The harness owns action validation and execution.

Each action should define:

* type
* input payload
* validation rules
* permission requirements
* execution behavior
* success result
* failure result
* audit metadata

Do not execute state-changing behavior directly from unvalidated model output.

⸻

13. Inference Rules

All model calls must go through a provider-agnostic inference interface.

Do not call provider SDKs directly from agents, runtime, UI, tools, or workflows.

Provider-specific code belongs only in provider adapters.

The inference layer should normalize:

* request format
* messages or context payloads
* multimodal inputs
* model parameters
* response format
* usage metadata
* errors
* streaming events if supported

Testing should use fake or mock providers, not live LLM calls by default.

⸻

14. Testing Rules

Every feature should include tests.

Prefer these test categories:

* domain unit tests
* contract validation tests
* runtime orchestration tests
* provider adapter tests
* fake provider tests
* tool execution tests
* action validation tests
* state transition tests
* API contract tests
* integration tests where useful
* regression tests for discovered failures

Do not rely on live LLM output for deterministic tests.

Use mocked inference responses.

Test malformed structured responses.

Test provider failure.

Test invalid action proposals.

Test unauthorized tool use.

Test state transition failure.

⸻

15. Documentation Rules

Documentation is part of the system.

Update documentation when changing:

* architecture
* domain concepts
* module boundaries
* configuration format
* contracts
* agent definitions
* runtime flow
* provider integration
* tools
* actions
* state model
* public APIs

Use ADRs for significant decisions.

An ADR should include:

* decision
* context
* alternatives considered
* consequences
* risks
* rollback or migration strategy where relevant

⸻

16. Failure Modes to Consider

For every feature, consider whether it introduces or affects:

* malformed model output
* missing contract fields
* schema version mismatch
* invalid configuration
* provider timeout
* provider outage
* provider response drift
* tool execution failure
* unauthorized tool access
* invalid action proposal
* failed state update
* stale state
* concurrent execution conflict
* partial workflow failure
* UI/backend contract mismatch
* multimodal input mismatch
* silent data corruption
* hidden coupling
* unclear ownership
* untested behavior

Do not ignore failure modes because a feature appears small.

⸻

17. Review Checklist

Before considering a task complete, verify:

* The responsible specialized agents were identified.
* The change belongs in the selected module.
* The implementation follows existing architecture.
* No provider-specific logic leaked into core runtime or domain.
* No UI-specific logic leaked into domain.
* State changes are explicit.
* Actions are validated before execution.
* Contracts are structured and validated.
* Failure modes were considered.
* Tests were added or updated.
* Documentation or ADRs were updated if needed.
* The code remains easy to navigate.
* The change does not introduce unnecessary abstraction.
* The change does not hardcode what should be configuration-driven.

⸻

18. Anti-Patterns

Avoid:

* one giant agent file
* scattered prompt strings
* hardcoded provider logic
* hardcoded workflow logic
* implicit state mutation
* unvalidated action execution
* untyped tool payloads
* natural-language-only execution responses
* UI-driven domain design
* provider-driven architecture
* circular dependencies
* undocumented architectural decisions
* tests that require live LLM calls by default
* features implemented without knowing where they belong
* abstractions that do not reduce complexity
* code that only the original author can understand

⸻

19. Preferred Implementation Sequence

When building new functionality, prefer this order:

1. define or inspect the domain model
2. define or inspect the contract
3. define state impact
4. define tool/action impact
5. define runtime integration
6. define tests
7. implement the smallest coherent slice
8. run or update tests
9. review
10. document

Do not start from UI unless the task is explicitly UI-only.

Do not start from provider SDKs unless the task is explicitly provider-adapter work.

Do not start from prompts unless the task is explicitly agent-configuration work.

⸻

20. Final Instruction

Always optimize for a codebase that is easy to understand, easy to navigate, easy to test, and easy to extend.

The goal is not to produce the most code.

The goal is to preserve a coherent harness architecture where agents, sheets, state, tools, contracts, actions, inference, workflows, and UI each have a clear place.

When uncertain, pause implementation and route the task to the Architecture Agent and Review Agent first.