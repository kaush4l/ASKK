//! THE STRATEGY LOOP, through `step` and against the real shipped `main`.
//!
//! What a route DOES is a sequence of effects a turn produces, so every
//! assertion here drives the machine rather than calling `route_of` and
//! believing it. A unit test of the parser could pass while the turn it steers
//! ended in the wrong place, which is the failure this file exists to catch.

mod common;

use agent::{
    adopt_spec, parse_agent_file, step, AgentState, Effect, Route, STAGE_ANSWER, STAGE_STRATEGY,
};
use kernel::{Event, EventId, EventKind, Timestamp};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const AT: Timestamp = Timestamp(1_753_800_000_000);

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: AT, kind }
}

fn user(text: &str) -> Event {
    ev(EventKind::UserMessage {
        text: text.into(),
        agent: String::new(),
        from: String::new(),
    })
}

fn replied(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

/// The shipped agent, mid-turn, having just voted.
fn voted(vote: &str) -> (AgentState, Vec<Effect>) {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    common::brief(&mut state);
    let (state, _) = step(state, user("do the thing"));
    step(state, replied(vote))
}

fn stage_facts(effects: &[Effect]) -> Vec<String> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
                if kind == agent::STAGE_ENTERED =>
            {
                Some(agent::stage_of(payload_json))
            }
            _ => None,
        })
        .collect()
}

/// The `core.route_chosen` fact a turn left behind, read back through the
/// projection a view uses rather than out of the raw payload.
fn route_fact(effects: &[Effect]) -> Option<(String, String)> {
    effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::ROUTE_CHOSEN =>
        {
            Some(agent::route_of(payload_json))
        }
        _ => None,
    })
}

/// THE TURN OPENS ON THE VOTE. `main` declares one stage and it does no work:
/// the first call of every turn asks how much turn this message deserves.
#[test]
fn a_turn_opens_by_asking_which_loop_to_run() {
    let spec = parse_agent_file("main", MAIN).expect("main parses");
    assert_eq!(spec.stages, [STAGE_STRATEGY], "the shipped file declares the vote");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    common::brief(&mut state);
    let (state, effects) = step(state, user("hello"));
    assert_eq!(stage_facts(&effects), ["strategy"]);
    assert_eq!(agent::current_stage(&state), STAGE_STRATEGY);
}

/// EACH VOTE INSTALLS ITS OWN LOOP, and the loop is what the rest of the turn
/// walks. The three routes are the three shapes of request a person has.
#[test]
fn each_route_installs_the_loop_it_named() {
    for (vote, expected) in [
        ("ROUTE: answer\nWHY: it is a greeting", vec![STAGE_ANSWER]),
        ("ROUTE: react\nWHY: needs a search", vec!["work"]),
        (
            "ROUTE: project\nWHY: something to build",
            vec!["plan", "work", "verify", "critique"],
        ),
    ] {
        let (state, effects) = voted(vote);
        assert_eq!(state.stages, expected, "vote {vote:?}");
        // …and the turn is already IN the first stage of it, with the call made.
        assert_eq!(stage_facts(&effects), [expected[0].to_string()]);
        assert!(
            effects.iter().any(|e| matches!(e, Effect::CallModel { .. })),
            "the chosen loop is entered, not merely recorded: {effects:?}"
        );
    }
}

/// THE VOTE IS NOT A TURN, so it is not written down as one. Putting
/// `assistant: ROUTE: project` in the conversation would show the person a
/// reply they were never given, and would leave the model reading its own
/// routing decision back as context on every turn after it.
#[test]
fn the_vote_never_enters_the_conversation() {
    let (state, _) = voted("ROUTE: project\nWHY: something to build");
    let window = agent::window(&state.paper);
    assert!(
        !window.iter().any(|line| line.contains("ROUTE")),
        "the vote is a decision about the turn, not a turn: {window:?}"
    );
    assert!(
        window.iter().any(|line| line.contains("do the thing")),
        "…and what the person actually said is still there: {window:?}"
    );
}

/// AN UNREADABLE VOTE IS `react`, AND THAT DIRECTION IS DELIBERATE. React is
/// the only route that can still reach either outcome — it can answer in prose
/// on its first call and it can call tools until it is done. Failing to
/// `answer` would strand a request that needed a tool; failing to `project`
/// would bill four calls for a greeting.
#[test]
fn an_unreadable_vote_lands_in_the_middle_route() {
    for reply in [
        "I think this one needs a web search first.", // answered instead of voting
        "ROUTE: whatever",                            // not one of the three
        "",                                           // said nothing
    ] {
        assert_eq!(agent::vote_of(reply), Route::React, "reply {reply:?}");
    }
    // WHICH SHAPES ARE READABLE IS A SEPARATE QUESTION, and it is answered by
    // `a_vote_is_read_through_the_emphasis_a_model_puts_around_it` below. This
    // test used to carry a comment claiming the parser handled `**ROUTE:**
    // project` "often enough to matter" while the parser did the opposite —
    // a sentence asserting the negation of the code beside it (I16), and the
    // reason the defect survived two rounds of reading this file.
}

/// THE `answer` ROUTE CANNOT ACT, and it is enforced rather than announced —
/// the `engine: base` lesson (19). The vote said this needs no tool; a stage
/// still shown the toolbox would reach for one, and the vote would have been
/// worth nothing.
#[test]
fn the_answer_route_is_shown_no_tools() {
    let (_, effects) = voted("ROUTE: answer\nWHY: it is a greeting");
    let Some(Effect::CallModel { document, .. }) = effects.iter().find(|e| {
        matches!(e, Effect::CallModel { .. })
    }) else {
        panic!("expected the answering call: {effects:?}");
    };
    let sent = format!("{document:?}");
    assert!(sent.contains("No tools are installed"), "the answer route offers nothing");
    assert!(!sent.contains("exec("), "…and cannot reach the shell");
}

/// A NEW MESSAGE STARTS FROM THE DECLARATION, NOT FROM THE LAST ROUTE. The
/// second message of a conversation must be voted on afresh: without the
/// separate `declared` list, a greeting arriving after a project would still be
/// walking plan → work → verify → critique.
#[test]
fn the_next_message_is_voted_on_again() {
    // A turn taken all the way to its end, so the next message is a new TURN
    // and not a steer into this one.
    let (state, _) = voted("ROUTE: answer\nWHY: it is a greeting");
    assert_eq!(state.stages, [STAGE_ANSWER]);
    let (state, _) = step(state, replied("Hello — what would you like to do?"));
    let (state, effects) = step(state, user("now build me a script that sorts a file"));
    assert_eq!(state.stages, [STAGE_STRATEGY], "back to the declared list");
    assert_eq!(stage_facts(&effects), ["strategy"]);
    // …and this one can vote its way to the long loop, which is the whole
    // point of asking again rather than inheriting.
    let (state, _) = step(state, replied("ROUTE: project\nWHY: it asks for a script"));
    assert_eq!(state.stages, ["plan", "work", "verify", "critique"]);
}

/// THE ROUTE IS A FACT, because a turn that silently became four calls instead
/// of one is a thing only the bill explains otherwise (I8). It carries the WHY
/// with it: the vote alone says the machine chose, and the clause says what it
/// chose on.
#[test]
fn the_chosen_route_is_recorded_with_its_reason() {
    let (_, effects) = voted("ROUTE: project\nWHY: it asks for a working script");
    let found = effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::ROUTE_CHOSEN =>
        {
            Some(agent::route_of(payload_json))
        }
        _ => None,
    });
    assert_eq!(
        found,
        Some(("project".into(), "it asks for a working script".into())),
        "the route and what decided it: {effects:?}"
    );
}

/// THE PLAN STAGE'S TOOL RESULT COMES BACK TO THE PLAN STAGE.
///
/// `plan` is granted the skill tools so its brief's "read the ones that apply"
/// is real. That makes it the first toolless-by-default stage that can produce
/// a tool call, so the round-trip has to work there too: the call runs, the
/// result lands in `## observations`, and the SAME stage is asked again with it.
/// A result that arrived after the stage had moved on would be instruction
/// pulled in for a stage that no longer needed it.
#[test]
fn a_skill_read_in_the_plan_stage_comes_back_to_the_plan_stage() {
    let (state, _) = voted("ROUTE: project\nWHY: something to build");
    assert_eq!(agent::current_stage(&state), "plan");
    let (state, effects) = step(state, replied("list_skills({})"));
    // `list_skills` is PURE, so `step` answers it itself and emits the result
    // rather than asking the runtime to run it. The runtime appends that fact
    // and steps again, which is what this does.
    let Some(Effect::Emit { kind }) = effects.first() else {
        panic!("the plan stage's call is answered: {effects:?}");
    };
    assert!(matches!(kind, EventKind::ToolInvoked { .. }), "{kind:?}");
    let (state, effects) = step(state, ev(kind.clone()));
    assert_eq!(agent::current_stage(&state), "plan", "still planning");
    let Some(Effect::CallModel { document, .. }) =
        effects.iter().find(|e| matches!(e, Effect::CallModel { .. }))
    else {
        panic!("the plan stage is asked again with what it read: {effects:?}");
    };
    let sent = format!("{document:?}");
    assert!(sent.contains("agent-file"), "the skill listing is in the paper: {sent}");
    assert!(sent.contains("OUTCOME"), "…under the plan brief, still");
}

/// **THE SHAPES A SMALL MODEL ACTUALLY WRITES A VOTE IN.**
///
/// The contract asks for two named lines. A 7B asked for two named lines
/// writes them as a markdown list about as often as it writes them bare, and
/// it emphasises the label because the label looks like a heading. Reading the
/// LABEL raw while cleaning only the VALUE meant every one of those shapes was
/// an unreadable vote, and an unreadable vote is `react` — so bold, bullets and
/// numbering silently cost the `answer` route its cheap turn and the `project`
/// route its plan.
///
/// The negative half is the more important half. The label must OPEN its line
/// after list markers and emphasis are taken off and nothing else, because the
/// alternative — finding `ROUTE:` anywhere — makes any sentence ABOUT routing
/// into a vote.
#[test]
fn a_vote_is_read_through_the_emphasis_a_model_puts_around_it() {
    for (reply, expected, because) in [
        ("ROUTE: project", Route::Project, "the shape the contract asks for"),
        ("**ROUTE:** project", Route::Project, "bold label, colon inside the bold"),
        ("**ROUTE**: answer", Route::Answer, "bold label, colon outside it"),
        ("- ROUTE: answer", Route::Answer, "a bullet: two named lines look like a list"),
        ("1. ROUTE: project", Route::Project, "a numbered list, same cause"),
        ("   ROUTE: answer", Route::Answer, "an indent, from the same list habit"),
        ("ROUTE: Project.", Route::Project, "a trailing period"),
        ("ROUTE: `react`", Route::React, "the value in a code span"),
        // LOWERCASE PARSES. A model that lowercases the label has made the
        // same harmless deviation as one that bolds it, and the value was
        // always lowercased before comparison — rejecting the label alone
        // would strand a vote that is in every other way well formed.
        ("route: answer", Route::Answer, "a lowercased label is still the label"),
        // …AND THESE MUST NOT PARSE.
        // `=` is not the separator the contract states. Widening the grammar
        // to a shape nothing was ever told to write buys a case we would then
        // have to keep working, and an unreadable vote is already safe.
        ("ROUTE = project", Route::React, "not the stated separator"),
        // The label must open its line. Finding it mid-sentence would turn
        // every discussion of routing into a vote.
        ("I think the ROUTE: project is best", Route::React, "prose about routing"),
        ("ROUTE: whatever", Route::React, "not one of the three words"),
        ("", Route::React, "said nothing"),
        ("I think this one needs a web search first.", Route::React, "answered instead of voting"),
    ] {
        assert_eq!(agent::vote_of(reply), expected, "{reply:?} — {because}");
    }
}

/// **THE `WHY` IS READ THE SAME WAY THE ROUTE IS.** It is the one field that
/// exists to make a route debuggable, and it was parsed with the identical
/// raw-label bug: a model that bolds one label bolds both, so exactly the
/// replies whose route was lost also lost their reason.
#[test]
fn the_reason_survives_the_same_emphasis_the_vote_does() {
    let (_, effects) = voted("**ROUTE:** project\n**WHY:** it asks for a working script");
    assert_eq!(
        route_fact(&effects),
        Some(("project".into(), "it asks for a working script".into())),
        "a bolded reply is still a decision with a reason: {effects:?}"
    );
}

/// **A FALLBACK IS NOT A VOTE, AND THE LOG SAYS WHICH.**
///
/// Both arms matter, and they are why this cannot be satisfied by a constant.
/// A genuine `ROUTE: react` and an unreadable reply both install the middle
/// route and both used to emit a byte-identical fact, so a run that routed
/// every message to react because the model started bolding its labels was
/// indistinguishable from a run whose messages all wanted react. The `how`
/// field is a flat scalar with two closed values so a panel can render it
/// without being taught a sentinel.
#[test]
fn the_fact_distinguishes_a_vote_for_react_from_an_unreadable_reply() {
    let how = |reply: &str| {
        let (_, effects) = voted(reply);
        let payload = effects
            .iter()
            .find_map(|e| match e {
                Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
                    if kind == agent::ROUTE_CHOSEN =>
                {
                    Some(payload_json.clone())
                }
                _ => None,
            })
            .expect("every route is a fact");
        (agent::route_of(&payload).0, agent::route_voted(&payload), payload)
    };

    let (route, was_voted, payload) = how("ROUTE: react\nWHY: it needs a search");
    assert_eq!(route, "react");
    assert!(was_voted, "the model asked for this route: {payload}");
    assert!(payload.contains(agent::VOTE_VOTED), "…and says so in the payload: {payload}");

    let (route, was_voted, payload) = how("I have no idea what you want.");
    assert_eq!(route, "react", "an unreadable reply still installs the middle route");
    assert!(!was_voted, "…but nobody voted for it: {payload}");
    assert!(payload.contains(agent::VOTE_FELL_BACK), "{payload}");

    // …and a route that is not react cannot be reached by falling back at all,
    // so its fact is always a vote.
    let (route, was_voted, _) = how("**ROUTE:** project\n**WHY:** it asks for a script");
    assert_eq!((route.as_str(), was_voted), ("project", true));
}

/// The two blocks the strategy stage is asked to decide from, as the model
/// receives them: the brief (slot 95) and the reply shape (slot 99).
fn strategy_blocks() -> (String, String) {
    let spec = parse_agent_file("main", MAIN).expect("main parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    common::brief(&mut state);
    let (_, effects) = step(state, user("do the thing"));
    let Some(Effect::CallModel { document, .. }) =
        effects.into_iter().find(|e| matches!(e, Effect::CallModel { .. }))
    else {
        panic!("the vote is asked for");
    };
    let text = |id: &str| {
        document
            .sections
            .iter()
            .find(|s| s.id.0 == id)
            .unwrap_or_else(|| panic!("{id} is in the strategy paper"))
            .parts
            .iter()
            .map(|p| match p {
                context::Part::Text { text } => text.clone(),
                other => format!("{other:?}"),
            })
            .collect::<String>()
    };
    (text("directive"), text("response_contract"))
}

/// **THE ROUTE CRITERIA LIVE IN THE FILE A PERSON CAN EDIT, AND ONLY THERE.**
///
/// They used to be a Rust string literal while `public/stages/strategy.md` was
/// one sentence with no criteria in it: the half that decided the route needed
/// a rebuild to change, and the half a person would open and edit changed
/// nothing that mattered.
///
/// MOVING THEM IS SAFE BECAUSE THE BRIEF IS ALWAYS THERE. `brief::contract`
/// hands the shaped object to the `strategy` stage and to no other, and
/// `brief::keyed` lists `strategy` among the stages that MUST be briefed — a
/// missing or empty `strategy.md` refuses at load and again at the stage. So
/// there is no path on which the contract is rendered without the brief beside
/// it, and no second copy is needed to cover one.
///
/// THE DRIFT THIS PINS is therefore not two copies disagreeing but a copy
/// coming back: the reply shape must name each route exactly once — in the
/// field that says which word to write — and never define one. A fourth
/// `Route` breaks the match below and the file stops compiling until somebody
/// writes that route's criteria into the brief.
#[test]
fn the_route_criteria_live_in_the_brief_and_are_not_copied_into_the_contract() {
    let (directive, contract) = strategy_blocks();
    for route in [Route::Answer, Route::React, Route::Project] {
        let word = match route {
            Route::Answer => "answer",
            Route::React => "react",
            Route::Project => "project",
        };
        assert_eq!(word, route.as_str(), "the enum and the brief use one vocabulary");
        assert!(
            directive.contains(word),
            "a route the machine can install with no criteria a person can read: {word}"
        );
        assert_eq!(
            contract.matches(word).count(),
            1,
            "{word} is named once in the reply shape — as a word to write, not defined \
             a second time. The criteria belong in public/stages/strategy.md.\n{contract}"
        );
    }
    // …and the criteria are worked, not asserted: each route carries examples
    // and at least one thing that is NOT it, which is the half that makes a
    // boundary predictable.
    assert_eq!(directive.matches("Examples:").count(), 3, "{directive}");
    assert_eq!(directive.matches("Not this:").count(), 3, "{directive}");
}

/// **A LATENT TOTAL FAILURE, PINNED BEFORE IT CAN HAPPEN.**
///
/// `components::respond` renders the vote contract under `Form::Json` as an
/// object — and `vote_of` cannot read an object at all, so every reply would
/// fall back and every message in the build would route to react. Measured:
/// the JSON reply below reads as react today.
///
/// It is dead only because `Form::for_target` answers Markdown for every
/// target there is. That is the load-bearing fact, so it is the one asserted:
/// the day a provider that can constrain generation lands and this chooser
/// starts answering Json, this test goes red instead of the router going
/// quietly uniform.
#[test]
fn a_json_vote_is_unreadable_so_no_target_may_ask_for_json_yet() {
    let written = r#"{"route": "project", "why": "it asks for a working script"}"#;
    assert_eq!(
        agent::vote_of(written), Route::React,
        "an object is not a labelled line, and an unreadable vote is react"
    );
    for target in [
        context::ProviderFormat::OpenAiChat { vision: false, audio: false },
        context::ProviderFormat::OpenAiChat { vision: true, audio: true },
        context::ProviderFormat::Anthropic,
        context::ProviderFormat::Gemini,
    ] {
        assert_eq!(
            context::Form::for_target(target), context::Form::Markdown,
            "{target:?} would be sent a JSON vote contract that vote_of cannot parse — \
             teach the parser the object shape before flipping this chooser"
        );
    }
}
