//! THE DEBUG PANE: the facts the harness already emits and nothing ever read.
//!
//! Five of them, each measured at zero readers outside the crate that emits it:
//! `core.route_chosen` (which loop the turn chose, and why), `PhaseEntered`,
//! `StoreFailed` (the conversation stopped being saved), the `document_hash` on
//! `ModelCalled`, and the tool-calling `ModelReplied` rounds — the model's own
//! working, which the transcript counts and draws nothing for.
//!
//! ONE OF THE FIVE CANNOT HAPPEN, AND IT IS SAID HERE RATHER THAN LEFT TO BE
//! FOUND (I17). `PhaseEntered` has a reader now, and nothing in this build
//! emits it: `runtime::pump` appends it only when `app.agent.phase` moves, and
//! `agent::AgentState::phase` is assigned nowhere in `crates/agent` — the stage
//! machine superseded the phase machine and left the field behind. The
//! projection is unit-tested against constructed facts (`projected.rs`) and no
//! integration test can reach it. The machine fact that would settle it is an
//! assignment to `state.phase`; there is none.
//!
//! I8 says every view is a projection of the log. The converse is what this
//! module is about: a fact in the log that NO view projects is a fact the
//! system holds and does not state, which is I16's defect wearing an event's
//! clothes. Nothing here is new instrumentation.
//!
//! `route` reads the route fact and answers what stages it really walks —
//! `board::stage` asks it too, because the board was counting against the
//! DECLARED list and the declared list is not what a routed turn walks.
//! `turns` folds the log into turns; `spine` draws what a turn decided;
//! `render` shapes the panel; `round` draws one model call; `store` draws the
//! failed writes; `pane` is the module.

pub(crate) mod pane;
mod render;
pub(crate) mod route;
mod round;
mod spine;
mod store;
mod turns;
