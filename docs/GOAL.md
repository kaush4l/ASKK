# Goal

A configuration-driven, browser-first AI harness where **the sheet of paper is the execution model**.

A *sheet* is the complete, typed, serializable working surface for one agent invocation: identity,
directive, tools, state, memory, multimodal input, inference config, response contract, action
policy, output mode. An *agent* is nothing but configuration selecting and parameterizing sheet
elements. A *run* is a loop of: assemble sheet → render → infer → parse against contract → gate and
execute tools/actions → absorb effects → emit signals — until a verified terminal.

The harness must make it cheap to add a new agent (drop a markdown file), a new provider (one
adapter), a new tool (one registration), a new contract (one field list), a new workflow (phase
config), a new state store (one trait impl), a new UI surface (fold over the signal log) — without
touching the core.

Three prior implementations (ASKK Rust/Dioxus, kiln JS, LocalAgents Python) converged on the same
findings; this build formalizes them:

- agents are markdown strings, not code
- tools are one narrow callable behind one trait
- progress is an event stream; UI state is a fold over it
- phases need verifier gates; runs never report false success
- providers map a rendered request, they never compose prompts
- every wait has an owner and a terminal

Non-goals: not a chatbot, not a one-off workflow, not a server product (browser-only full stack;
"backend" = web workers + OPFS). Legibility beats feature parity.
