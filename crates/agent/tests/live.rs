//! THE WORKFLOW AGAINST A REAL MODEL.
//!
//! Every other test in this repo scripts the replies, which proves the machine
//! does what it is told and proves nothing about whether a model does what the
//! PROMPT tells it. The strategy loop is entirely a bet on the second: a vote a
//! 12B cannot reliably write is a vote that always lands in `react`, and every
//! test here would still be green.
//!
//! So this one drives the real `step` function against
//! `gemma-4-12B-it-qat-mxfp8` on the local endpoint, with the real shipped
//! `main` agent, and asserts on what comes back.
//!
//! IGNORED BY DEFAULT (`cargo test -p agent --test live -- --ignored`). It
//! needs a model running, so on a machine with none it would fail for a reason
//! that is not a bug. It is not marked `#[cfg]`-off, because a test nobody can
//! run by name is a test nobody runs.
//!
//! IT SHELLS OUT TO `curl` RATHER THAN TAKING AN HTTP DEPENDENCY. Every crate
//! here is pure and host-testable with no network (I3) — adding `reqwest` to
//! the agent crate's dev-dependencies to test the agent crate would put a TLS
//! stack and its transitive tree behind a rule whose whole point is that there
//! is nothing to mock. `curl` is already on every machine this runs on, and
//! this is the only file that uses it.

use std::process::Command;

use agent::{adopt_spec, parse_agent_file, space_parts, step, AgentState, Effect, SPACE_FACULTY};
use context::{openai_reply_text, openai_request_body, render, ProviderFormat};
use kernel::{Event, EventId, EventKind, Timestamp};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const ENDPOINT: &str = "http://127.0.0.1:8873/v1/chat/completions";
const MODEL: &str = "gemma-4-12B-it-qat-mxfp8";
const AT: Timestamp = Timestamp(1_753_800_000_000);
const FMT: ProviderFormat = ProviderFormat::OpenAiChat { vision: false, audio: false };

fn user(text: &str) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        },
    }
}

fn replied(text: &str) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::ModelReplied { text: text.into(), agent: String::new() },
    }
}

/// Send one assembled Document to the local model and return what it said.
fn ask_the_model(effect: &Effect) -> String {
    let Effect::CallModel { document, temperature, .. } = effect else {
        panic!("expected a model call, got {effect:?}");
    };
    let body = openai_request_body(&render(document, FMT), MODEL, *temperature);
    let out = Command::new("curl")
        .args(["-s", "--max-time", "180", ENDPOINT, "-H", "content-type: application/json", "-d", "@-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().expect("stdin").write_all(body.as_bytes())?;
            child.wait_with_output()
        })
        .expect("curl runs");
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    openai_reply_text(&text).unwrap_or_else(|| {
        // The prompt goes with the failure. A local model that answers with an
        // empty `message` is not a bug in the machine, and the only way to tell
        // which it is is to read what it was asked.
        panic!("no reply in what the endpoint returned: {text}\n\nIT WAS ASKED:\n{body}")
    })
}

/// Advance until the machine wants the model again, then ask it.
///
/// Between two model calls the runtime may have work of its own: a pure tool
/// answers inline and `step` EMITS the result, which the runtime appends and
/// steps on. This is that loop, and it is the whole difference between driving
/// the real machine and driving an idea of it.
fn pump(mut state: AgentState, mut effects: Vec<Effect>) -> (AgentState, String) {
    for _ in 0..16 {
        if let Some(call) = effects.iter().find(|e| matches!(e, Effect::CallModel { .. })) {
            let said = ask_the_model(call);
            return (state, said);
        }
        let Some(Effect::Emit { kind }) = effects.first() else {
            panic!("nothing to feed back and no call to make: {effects:?}");
        };
        (state, effects) = step(state, Event { id: EventId(0), seq: 0, at: AT, kind: kind.clone() });
    }
    panic!("the turn never came back to the model");
}

/// [`pump`], but `None` when the turn is over rather than a panic. A turn that
/// ends is a legitimate outcome for a message the model chose to just answer.
fn pumped(mut state: AgentState, mut effects: Vec<Effect>) -> Option<(AgentState, String)> {
    for _ in 0..16 {
        if let Some(call) = effects.iter().find(|e| matches!(e, Effect::CallModel { .. })) {
            return Some((state, ask_the_model(call)));
        }
        let Some(Effect::Emit { kind }) = effects.first() else {
            return None;
        };
        (state, effects) = step(state, Event { id: EventId(0), seq: 0, at: AT, kind: kind.clone() });
    }
    None
}

fn shipped_main() -> AgentState {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    // THE HOST, STOOD IN FOR. A faculty block renders what a host last left
    // under its id, and this crate has none — `core::space::sense::SpaceSense`
    // does it in the running app. Without this the model would be asked about a
    // workspace it was never shown, which is a harder question than the one the
    // shipped agent actually gets.
    let parts = space_parts(&state.space);
    state.senses.insert(SPACE_FACULTY.to_string(), parts);
    state
}

/// Ask the real model to vote on one message, and return what route the machine
/// read out of the reply — plus the reply, so a failure says what was said.
fn vote_on(message: &str) -> (agent::Route, String) {
    let (state, effects) = step(shipped_main(), user(message));
    assert_eq!(agent::current_stage(&state), agent::STAGE_STRATEGY);
    let call = effects
        .iter()
        .find(|e| matches!(e, Effect::CallModel { .. }))
        .expect("the vote is a model call");
    let said = ask_the_model(call);
    (agent::vote_of(&said), said)
}

/// THE VOTE IS ACTUALLY WRITTEN, in the shape the response object asks for.
///
/// This is the assertion the whole strategy loop rests on. If a 12B cannot
/// write `ROUTE: answer` when the contract asks for it, every message lands in
/// `react` by the fallback and the routing is decoration.
#[test]
#[ignore = "needs the local model at 127.0.0.1:8873"]
fn the_model_votes_in_the_shape_the_contract_asks_for() {
    let (route, said) = vote_on("hello, how are you?");
    assert!(
        said.lines().any(|l| l.trim_start().starts_with("ROUTE")),
        "the reply carries the line the contract named: {said}"
    );
    assert_eq!(route, agent::Route::Answer, "a greeting needs no tool: {said}");
}

/// …AND IT TELLS THE THREE APART. Three messages a person would plainly sort
/// differently, sorted the same way by the model.
#[test]
#[ignore = "needs the local model at 127.0.0.1:8873"]
fn the_three_routes_are_told_apart() {
    for (message, expected) in [
        ("what is the capital of France?", agent::Route::Answer),
        (
            "what is in the workspace folder right now?",
            agent::Route::React,
        ),
        (
            "build me a Python script that reads a CSV, sorts it by the second \
             column and writes it back out, and check that it runs",
            agent::Route::Project,
        ),
    ] {
        let (route, said) = vote_on(message);
        assert_eq!(route, expected, "message {message:?} was voted:\n{said}");
    }
}

/// THE PROJECT ROUTE WALKS ITS LOOP AGAINST THE REAL MODEL: it reads the
/// installed skills, then writes a brief in the lines its directive asks for,
/// then hands that brief to the work stage.
///
/// THE SKILL CALL IS THE FIRST THING THAT HAPPENS, and finding that out is why
/// this test exists. The plan directive says to call `list_skills` before
/// writing anything, and the model does exactly that — so a version of this
/// test that expected the brief in the first reply failed against a prompt that
/// was working correctly. The tool RESULT is fed back here rather than run,
/// because the tool runtime lives in `core` behind ports this test does not
/// have; the catalogue it returns is the real one.
///
/// It stops after the brief reaches the work stage. What is being proved is
/// that the prompt gets the model to produce what the next stage depends on,
/// which is the part no scripted test can show.
#[test]
#[ignore = "needs the local model at 127.0.0.1:8873"]
fn a_project_turn_plans_before_it_works() {
    let goal = "build me a Python script that counts the lines in a file, and check that it runs";
    let (state, effects) = step(shipped_main(), user(goal));
    let (state, vote) = pump(state, effects);
    assert_eq!(agent::vote_of(&vote), agent::Route::Project, "voted:
{vote}");

    let (state, effects) = step(state, replied(&vote));
    assert_eq!(state.stages, ["plan", "work", "verify", "critique"]);
    assert_eq!(agent::current_stage(&state), "plan");

    // THE PLAN STAGE READS BEFORE IT WRITES. Its directive says to check the
    // installed skills first, and against the real model that is what happens:
    // the first thing back is a `list_skills` call, not the brief. A version of
    // this test that expected the brief immediately failed against a prompt
    // that was working exactly as written.
    let (mut state, mut said) = pump(state, effects);
    assert!(
        agent::named(&said).iter().any(|c| c.contains(agent::LIST_SKILLS)),
        "the plan stage reads the installed instruction first: {said}"
    );

    // …and it keeps planning until it has a brief. It may read one of the
    // skills it just listed, which is the point of listing them.
    for _ in 0..4 {
        let (s, effects) = step(state, replied(&said));
        let (s, reply) = pump(s, effects);
        state = s;
        said = reply;
        if said.contains("OUTCOME") {
            break;
        }
    }
    let brief = said.clone();
    for line in ["OUTCOME", "PATHS", "CHECK", "DONE WHEN"] {
        assert!(brief.contains(line), "the brief is missing {line}:
{brief}");
    }

    // …and the brief hands off: the work stage that follows can see it.
    let (state, effects) = step(state, replied(&brief));
    assert_eq!(agent::current_stage(&state), "work");
    let Some(Effect::CallModel { document, .. }) =
        effects.iter().find(|e| matches!(e, Effect::CallModel { .. }))
    else {
        panic!("the work stage is asked");
    };
    assert!(
        format!("{document:?}").contains("OUTCOME"),
        "the work stage is given the plan it is working to"
    );
}

/// THE MEMORY FACULTY IS ACTUALLY REACHED (increment 27). `main` declares
/// `faculties: [memory]` and names `keep`, so the tool is in its toolbox and
/// the file's `## Your own memory` section tells it when to reach for it. This
/// asks the only question those two cannot answer between them: does a 12B,
/// told something about the person that will still be true next week, actually
/// call `keep`?
///
/// TWO THINGS WERE MEASURED TO GET HERE, and both are the reason this test is
/// shaped the way it is rather than the obvious way.
///
/// **It is asked on the work stage, not through the vote.** Run through the
/// strategy vote, this message is scored BOTH WAYS by the same model on the
/// same prompt: once `ROUTE: react` ("it requires using the memory system to
/// store a preference") and the next time `ROUTE: answer` ("a simple
/// preference update that can be confirmed immediately") — and the answer
/// stage is granted no tools, so that second turn replies "I have noted your
/// preference" having noted nothing at all. Which way the vote falls is
/// `the_three_routes_are_told_apart`'s question, not this one's.
///
/// **The message says the line is private, because that is the choice the
/// prompt teaches.** Asked to remember a preference with nothing said about
/// who it is for, the model split roughly two in three `keep` and one in three
/// `remember` — writing a personal habit into the shared space, which is the
/// exact confusion `## Your own memory` exists to settle. Told the same thing
/// with "nobody else working in this space needs to know it", it called `keep`
/// and only `keep` on four runs out of four. So this asserts on the harder and
/// more useful claim: the prompt does not merely expose the tool, it gets the
/// discrimination right.
#[test]
#[ignore = "needs the local model at 127.0.0.1:8873"]
fn the_model_keeps_what_it_was_asked_to_remember() {
    let message = "Remember that I prefer metric units. It is just about how I like you to \
                   talk to me — nobody else working in this space needs to know it.";
    let mut working = shipped_main();
    working.declared = vec![agent::STAGE_WORK.to_string()];
    working.stages = vec![agent::STAGE_WORK.to_string()];
    let (state, effects) = step(working, user(message));
    let (mut state, mut said) = pump(state, effects);
    let mut heard = vec![said.clone()];
    for _ in 0..4 {
        if agent::named(&said).iter().any(|c| c.starts_with("keep")) {
            break;
        }
        let (s, effects) = step(state, replied(&said));
        // The turn may simply END here — the answer route finishes after one
        // reply — and a turn that ended is an answer to the question this test
        // asks, not a crash.
        let Some((s, reply)) = pumped(s, effects) else { break };
        state = s;
        said = reply;
        heard.push(said.clone());
    }
    let transcript = heard.join("\n---- NEXT CALL ----\n");
    println!("EVERYTHING THE MODEL SAID:\n{transcript}");
    assert!(
        heard
            .iter()
            .any(|r| agent::named(r).iter().any(|c| c.starts_with("keep"))),
        "the turn never called keep. everything it said:\n{transcript}"
    );
    // …AND ONLY `keep`. This is the half that makes the test about the PROMPT
    // rather than about the toolbox: the failure mode actually observed was
    // `remember`, which writes a private habit onto a board every agent in the
    // space reads. Asserting the presence of `keep` alone would have been green
    // through it, and the doc comment above would have been describing a
    // discrimination the code never checked.
    assert!(
        !heard
            .iter()
            .any(|r| agent::named(r).iter().any(|c| c.starts_with("remember"))),
        "it also wrote to the SHARED space, which is the confusion this prompt \
         exists to settle:\n{transcript}"
    );
}

/// THE ANSWER ROUTE ANSWERS, IN ONE MORE CALL. Two calls for a greeting, and
/// the second one is the reply the person reads — not a plan, not a tool call.
#[test]
#[ignore = "needs the local model at 127.0.0.1:8873"]
fn the_answer_route_replies_to_the_person() {
    let (state, effects) = step(shipped_main(), user("what is the capital of France?"));
    let (state, vote) = pump(state, effects);
    assert_eq!(agent::vote_of(&vote), agent::Route::Answer, "voted:\n{vote}");
    let (state, effects) = step(state, replied(&vote));
    let (_, answer) = pump(state, effects);
    assert!(answer.to_lowercase().contains("paris"), "it answered: {answer}");
    assert!(!agent::has_calls(&answer), "…in prose, with no tool call: {answer}");
}
