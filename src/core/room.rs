//! # Room: several agents and a person in one setup
//!
//! A room is a **scenario** (what is going on and the rules, as text), **seats** (each a
//! session with some harness, given a name and a part to play) and the **lines** said so far.
//! A discussion, a board and a game are the same thing with a different scenario and
//! [`Rule`]: `round` lets every seat speak once per step, `turn` lets only the next seat speak.
//!
//! Each seat is a session of its own, so it remembers the room through its harness; a seat is
//! only ever sent what was said since it last spoke ([`brief`]).
//!
//! A [`Plan`] is a room before it exists: what a person fills in, or what the desk agent
//! writes from a wish ([`design_prompt`], [`parse_plan`]). Both are checked the same way.
use super::session::State;
use super::store::Store;
use serde::{Deserialize, Serialize};

/// The person's name in a room; no seat may take it.
pub const USER: &str = "user";

/// The most seats a room holds.
pub const MAX_SEATS: usize = 6;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rule {
    /// Every seat speaks once per step, in order.
    #[default]
    Round,
    /// Only the next seat speaks per step.
    Turn,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SeatPlan {
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub harness: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub rule: Rule,
    #[serde(default)]
    pub seats: Vec<SeatPlan>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Seat {
    pub name: String,
    #[serde(default)]
    pub role: String,
    pub harness: String,
    /// The session that plays this seat.
    pub session: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Line {
    /// A seat's name, or [`USER`].
    pub who: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Room {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub rule: Rule,
    pub seats: Vec<Seat>,
    #[serde(default)]
    pub lines: Vec<Line>,
    /// The seat that speaks next.
    #[serde(default)]
    pub next: usize,
    /// Seats still to speak in the step under way.
    #[serde(default)]
    pub pending: usize,
    #[serde(default)]
    pub state: State,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
}

/// A starting point a person can pick and change.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub name: String,
    #[serde(default)]
    pub rule: Rule,
    pub scenario: String,
}

/// The ways a thing can be made: `form` (a person fills in a room), `desk` (the desk agent
/// designs a room from a wish), `view` (the desk agent designs a page from a wish).
pub const MAKERS: &[&str] = &["form", "desk", "view"];

/// A way of working: which makers it offers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mode {
    pub name: String,
    #[serde(default)]
    pub about: String,
    pub makers: Vec<String>,
}

/// `modes.json`: the modes and presets on offer. They are curated as data; the code only
/// knows the makers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Curation {
    pub modes: Vec<Mode>,
    #[serde(default)]
    pub presets: Vec<Preset>,
}

impl Default for Curation {
    /// What a home without the file gets: one mode with the form, one preset.
    fn default() -> Self {
        Curation {
            modes: vec![Mode { name: "regular".into(), about: "Fill in the setup yourself".into(), makers: vec!["form".into()] }],
            presets: vec![Preset { name: "discussion".into(), rule: Rule::Round, scenario: "A discussion. Each speaker answers the question on the table from their own part, in a few sentences.".into() }],
        }
    }
}

impl Curation {
    /// The file's text, checked: at least one mode, every mode a known maker.
    pub fn read(text: &str) -> Result<Curation, String> {
        let c: Curation = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if c.modes.is_empty() {
            return Err("no modes".into());
        }
        for m in &c.modes {
            if m.name.trim().is_empty() || m.makers.is_empty() {
                return Err(format!("mode '{}' needs a name and at least one maker", m.name));
            }
            if let Some(bad) = m.makers.iter().find(|k| !MAKERS.contains(&k.as_str())) {
                return Err(format!("mode '{}': unknown maker '{bad}' (one of {})", m.name, MAKERS.join(", ")));
            }
        }
        Ok(c)
    }
}

/// What the desk agent is asked for a page: a wish in, one JSON page out.
pub fn view_prompt(wish: &str) -> String {
    format!(
        "Design a page for this app from this wish:\n{}\n\nA page is a tree of nodes. A node is {{\"kind\": …, \"text\": …, \"label\": …, \"children\": [nodes]}}; only \"kind\" is required. Kinds for layout and words: stack, row, grid, pane, heading, text, muted, badge, link (text = what it says, label = the path it opens). To place a built-in view use {{\"kind\": \"view\", \"text\": NAME}} where NAME is one of: {}. Use only these kinds.\n\nAnswer with one JSON object and nothing else:\n{{\"path\": \"one-lowercase-word\", \"title\": \"…\", \"nav\": 5, \"root\": {{node}}}}\nUse no tools.",
        wish.trim(),
        super::node::VIEWS.join(", ")
    )
}

/// The page in what the desk agent answered: where it goes and what it is. The caller checks
/// its nodes when saving it.
pub fn parse_view(text: &str) -> Result<(String, super::routes::Page), String> {
    let (a, b) = (text.find('{').ok_or("the answer holds no page")?, text.rfind('}').ok_or("the answer holds no page")?);
    let v: serde_json::Value = serde_json::from_str(text.get(a..=b).ok_or("the answer holds no page")?).map_err(|e| format!("the page does not read: {e}"))?;
    let path = v["path"].as_str().unwrap_or_default().trim().trim_matches('/').to_string();
    if path.is_empty() {
        return Err("the page names no path".into());
    }
    let page = serde_json::from_value(v).map_err(|e| format!("the page does not read: {e}"))?;
    Ok((path, page))
}

/// A plan a room can be made from, given the harness kinds that exist.
pub fn check(plan: &Plan, kinds: &[&str]) -> Result<(), String> {
    if plan.seats.is_empty() || plan.seats.len() > MAX_SEATS {
        return Err(format!("a room has 1 to {MAX_SEATS} seats, not {}", plan.seats.len()));
    }
    for (i, s) in plan.seats.iter().enumerate() {
        let name = s.name.trim();
        if name.is_empty() || name.eq_ignore_ascii_case(USER) || name.contains('\n') {
            return Err(format!("seat {}: '{name}' is not a name a seat can take", i + 1));
        }
        if plan.seats[..i].iter().any(|o| o.name.trim().eq_ignore_ascii_case(name)) {
            return Err(format!("two seats are named '{name}'"));
        }
        if !kinds.contains(&s.harness.as_str()) {
            return Err(format!("seat '{name}': unknown harness '{}' (one of {})", s.harness, kinds.join(", ")));
        }
    }
    Ok(())
}

fn key(root: &str, id: u64) -> String {
    format!("{root}/{id}.json")
}

fn save(store: &dyn Store, root: &str, r: &Room) -> Result<(), String> {
    store.put(&key(root, r.id), &serde_json::to_string_pretty(r).map_err(|e| e.to_string())?)
}

/// Every room under `root`, oldest first.
pub fn list(store: &dyn Store, root: &str) -> Vec<Room> {
    let mut all: Vec<Room> = store.list(root).iter().filter_map(|e| store.get(&format!("{root}/{}", e.name))).filter_map(|t| serde_json::from_str(&t).ok()).collect();
    all.sort_by_key(|r: &Room| r.id);
    all
}

pub fn get(store: &dyn Store, root: &str, id: u64) -> Result<Room, String> {
    let t = store.get(&key(root, id)).ok_or_else(|| format!("no room {id}"))?;
    serde_json::from_str(&t).map_err(|e| format!("room {id}: {e}"))
}

/// The id the next room gets.
pub fn next_id(store: &dyn Store, root: &str) -> u64 {
    list(store, root).last().map_or(1, |r| r.id + 1)
}

/// The title a room made from `plan` with `id` carries.
pub fn title(plan: &Plan, id: u64) -> String {
    let t = plan.title.trim();
    if t.is_empty() { format!("room {id}") } else { t.to_string() }
}

/// Make the room `id` from a checked plan; `sessions` are its seats' sessions, in seat order.
pub fn open(store: &dyn Store, root: &str, id: u64, plan: &Plan, sessions: &[u64]) -> Result<Room, String> {
    if sessions.len() != plan.seats.len() {
        return Err("one session per seat".into());
    }
    let seats = plan.seats.iter().zip(sessions).map(|(s, &session)| Seat { name: s.name.trim().into(), role: s.role.trim().into(), harness: s.harness.clone(), session }).collect();
    let r = Room { id, title: title(plan, id), scenario: plan.scenario.trim().into(), rule: plan.rule, seats, ..Default::default() };
    save(store, root, &r)?;
    Ok(r)
}

/// Begin a step: record what the person said (nothing = "go on") and name the seat that
/// speaks first. A room in the middle of a step takes no second one.
pub fn say(store: &dyn Store, root: &str, id: u64, text: &str) -> Result<usize, String> {
    let mut r = get(store, root, id)?;
    if r.state == State::Busy {
        return Err(format!("room {id} is in the middle of a step"));
    }
    if !text.trim().is_empty() {
        r.lines.push(Line { who: USER.into(), text: text.trim().into() });
    }
    r.next %= r.seats.len().max(1);
    r.pending = match r.rule {
        Rule::Round => r.seats.len(),
        Rule::Turn => 1,
    };
    r.state = State::Busy;
    r.error.clear();
    save(store, root, &r)?;
    Ok(r.next)
}

/// What the seat is sent: the setup the first time, then only what was said since it spoke.
pub fn brief(r: &Room, seat: usize) -> String {
    let me = &r.seats[seat];
    let last = r.lines.iter().rposition(|l| l.who == me.name);
    let mut out = String::new();
    if last.is_none() {
        let others: Vec<String> = r.seats.iter().filter(|s| s.name != me.name).map(|s| if s.role.is_empty() { s.name.clone() } else { format!("{} ({})", s.name, s.role) }).collect();
        out.push_str(&format!("You are {} in \"{}\".\n", me.name, r.title));
        if !me.role.is_empty() {
            out.push_str(&format!("Your part: {}\n", me.role));
        }
        out.push_str(&format!("\nThe setup:\n{}\n\n", r.scenario));
        if !others.is_empty() {
            out.push_str(&format!("The others: {}.\n", others.join("; ")));
        }
        out.push_str(&format!("A person (\"{USER}\") may also speak.\nEach time you are prompted you are given what was said since you last spoke. Answer only with what {} says or does next. Use no tools.\n\n", me.name));
    }
    let since = &r.lines[last.map_or(0, |i| i + 1)..];
    if !since.is_empty() {
        out.push_str("Since you last spoke:\n");
        for l in since {
            out.push_str(&format!("{}: {}\n", l.who, l.text.replace('\n', "\n  ")));
        }
        out.push('\n');
    }
    out.push_str("It is your turn.");
    out
}

/// Record what a seat said (or why it said nothing) and name the seat that speaks next in
/// this step, if any. A seat that fails ends the step and keeps the turn.
pub fn heard(store: &dyn Store, root: &str, id: u64, seat: usize, said: Result<String, String>) -> Result<Option<usize>, String> {
    let mut r = get(store, root, id)?;
    let name = r.seats.get(seat).map(|s| s.name.clone()).ok_or("no such seat")?;
    match said {
        Ok(text) => {
            r.lines.push(Line { who: name, text: text.trim().into() });
            r.next = (seat + 1) % r.seats.len();
            r.pending = r.pending.saturating_sub(1);
            if r.pending == 0 {
                r.state = State::Idle;
            }
        }
        Err(e) => {
            r.pending = 0;
            r.state = State::Failed;
            r.error = format!("{name}: {e}");
        }
    }
    save(store, root, &r)?;
    Ok((r.state == State::Busy).then_some(r.next))
}

/// After a restart nothing is speaking: a room left mid-step says so and can go on.
pub fn recover(store: &dyn Store, root: &str) {
    for mut r in list(store, root).into_iter().filter(|r| r.state == State::Busy) {
        r.pending = 0;
        r.state = State::Failed;
        r.error = "the host restarted in the middle of a step; go on to continue".into();
        let _ = save(store, root, &r);
    }
}

/// What the desk agent is asked: turn a wish into a plan, as JSON and nothing else.
pub fn design_prompt(wish: &str, kinds: &[&str]) -> String {
    format!(
        "Design a room for this wish:\n{}\n\nA room is a scenario (what is going on and every rule, as plain text the players are given), a rule for who speaks (\"round\": every seat speaks once per step; \"turn\": only the next seat speaks, for games with moves), and 1 to {MAX_SEATS} seats. Each seat has a short unique name, a part to play (one or two sentences) and a harness, one of: {}.\n\nAnswer with one JSON object and nothing else:\n{{\"title\": \"…\", \"scenario\": \"…\", \"rule\": \"round\" or \"turn\", \"seats\": [{{\"name\": \"…\", \"role\": \"…\", \"harness\": \"…\"}}]}}\nUse no tools.",
        wish.trim(),
        kinds.join(", ")
    )
}

/// The plan in what the desk agent answered (the JSON object in it), checked.
pub fn parse_plan(text: &str, kinds: &[&str]) -> Result<Plan, String> {
    let (a, b) = (text.find('{').ok_or("the answer holds no plan")?, text.rfind('}').ok_or("the answer holds no plan")?);
    let plan: Plan = serde_json::from_str(text.get(a..=b).ok_or("the answer holds no plan")?).map_err(|e| format!("the plan does not read: {e}"))?;
    check(&plan, kinds)?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::store::Bundle;

    const KINDS: &[&str] = &["echo", "other"];

    fn plan(rule: Rule) -> Plan {
        let seat = |n: &str, h: &str| SeatPlan { name: n.into(), role: format!("plays {n}"), harness: h.into() };
        Plan { title: "t".into(), scenario: "talk".into(), rule, seats: vec![seat("Ann", "echo"), seat("Bob", "other")] }
    }

    fn room(rule: Rule) -> Bundle {
        let st = Bundle::memory(Default::default());
        open(&st, "rooms", 1, &plan(rule), &[7, 8]).unwrap();
        st
    }

    #[test]
    fn a_round_lets_every_seat_speak_once() {
        let st = room(Rule::Round);
        assert_eq!(say(&st, "rooms", 1, "begin").unwrap(), 0);
        assert!(say(&st, "rooms", 1, "again").unwrap_err().contains("middle of a step"));
        assert_eq!(heard(&st, "rooms", 1, 0, Ok("a1".into())).unwrap(), Some(1));
        assert_eq!(heard(&st, "rooms", 1, 1, Ok("b1".into())).unwrap(), None);
        let r = get(&st, "rooms", 1).unwrap();
        assert_eq!(r.state, State::Idle);
        assert_eq!(r.lines.iter().map(|l| l.who.as_str()).collect::<Vec<_>>(), ["user", "Ann", "Bob"]);
    }

    #[test]
    fn a_turn_lets_only_the_next_seat_speak() {
        let st = room(Rule::Turn);
        assert_eq!(say(&st, "rooms", 1, "").unwrap(), 0);
        assert_eq!(heard(&st, "rooms", 1, 0, Ok("X at centre".into())).unwrap(), None);
        // Nothing said by the person: the step is "go on", and it is the other seat's move.
        assert_eq!(say(&st, "rooms", 1, "").unwrap(), 1);
        assert_eq!(heard(&st, "rooms", 1, 1, Ok("O at corner".into())).unwrap(), None);
        assert_eq!(get(&st, "rooms", 1).unwrap().lines.len(), 2);
    }

    #[test]
    fn a_seat_is_told_the_setup_once_then_only_what_it_missed() {
        let st = room(Rule::Round);
        say(&st, "rooms", 1, "begin").unwrap();
        let first = brief(&get(&st, "rooms", 1).unwrap(), 0);
        assert!(first.contains("You are Ann") && first.contains("plays Ann") && first.contains("talk") && first.contains("Bob (plays Bob)") && first.contains("user: begin"));
        heard(&st, "rooms", 1, 0, Ok("a1".into())).unwrap();
        heard(&st, "rooms", 1, 1, Ok("b1".into())).unwrap();
        say(&st, "rooms", 1, "more").unwrap();
        let second = brief(&get(&st, "rooms", 1).unwrap(), 0);
        assert!(!second.contains("You are Ann") && !second.contains("begin"));
        assert!(second.contains("Bob: b1") && second.contains("user: more"));
    }

    #[test]
    fn a_seat_that_fails_ends_the_step_and_keeps_the_turn() {
        let st = room(Rule::Round);
        say(&st, "rooms", 1, "begin").unwrap();
        heard(&st, "rooms", 1, 0, Ok("a1".into())).unwrap();
        assert_eq!(heard(&st, "rooms", 1, 1, Err("no program".into())).unwrap(), None);
        let r = get(&st, "rooms", 1).unwrap();
        assert_eq!((r.state, r.error.as_str(), r.next), (State::Failed, "Bob: no program", 1));
        assert_eq!(say(&st, "rooms", 1, "").unwrap(), 1);
    }

    #[test]
    fn a_plan_is_checked_whoever_wrote_it() {
        let mut p = plan(Rule::Round);
        p.seats[1].name = "ann".into();
        assert!(check(&p, KINDS).unwrap_err().contains("two seats"));
        p.seats[1].name = "User".into();
        assert!(check(&p, KINDS).unwrap_err().contains("not a name"));
        p.seats[1] = SeatPlan { name: "Bob".into(), role: String::new(), harness: "nope".into() };
        assert!(check(&p, KINDS).unwrap_err().contains("unknown harness 'nope'"));
        p.seats.clear();
        assert!(check(&p, KINDS).unwrap_err().contains("1 to 6 seats"));
    }

    #[test]
    fn the_desks_answer_becomes_a_plan_or_says_why_not() {
        let said = "Here is the room:\n```json\n{\"title\": \"Chess talk\", \"scenario\": \"Argue openings.\", \"rule\": \"turn\", \"seats\": [{\"name\": \"White\", \"role\": \"likes e4\", \"harness\": \"echo\"}]}\n```";
        let p = parse_plan(said, KINDS).unwrap();
        assert_eq!((p.title.as_str(), p.rule, p.seats.len()), ("Chess talk", Rule::Turn, 1));
        assert!(parse_plan("I cannot.", KINDS).unwrap_err().contains("no plan"));
        assert!(parse_plan("{\"seats\": [{\"name\": \"A\", \"harness\": \"gone\"}]}", KINDS).unwrap_err().contains("unknown harness"));
        assert!(design_prompt("a debate", KINDS).contains("echo, other"));
    }

    #[test]
    fn the_shipped_modes_read_and_a_wrong_one_is_refused_with_the_reason() {
        let shipped = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults/modes.json")).unwrap();
        let c = Curation::read(&shipped).unwrap();
        assert!(c.modes.iter().any(|m| m.makers.contains(&"desk".to_string())) && c.presets.iter().any(|p| p.rule == Rule::Turn));
        assert!(Curation::read(r#"{"modes": [{"name": "x", "makers": ["magic"]}]}"#).unwrap_err().contains("unknown maker 'magic'"));
        assert!(Curation::read(r#"{"modes": []}"#).unwrap_err().contains("no modes"));
        assert!(Curation::read(r#"{"modes": [{"name": "x", "makers": ["form"], "extra": 1}]}"#).unwrap_err().contains("unknown field"));
    }

    #[test]
    fn the_desks_page_is_read_and_its_nodes_are_checked_like_any_page() {
        let said = "```json\n{\"path\": \"/war-room/\", \"title\": \"War room\", \"nav\": 5, \"root\": {\"kind\": \"stack\", \"children\": [{\"kind\": \"heading\", \"text\": \"Now\"}, {\"kind\": \"view\", \"text\": \"rooms\"}]}}\n```";
        let (path, page) = parse_view(said).unwrap();
        assert_eq!((path.as_str(), page.title.as_str(), page.nav), ("war-room", "War room", Some(5)));
        assert!(crate::core::node::validate_node(&page.root).is_ok());
        let (_, bad) = parse_view(r#"{"path": "x", "root": {"kind": "iframe"}}"#).unwrap();
        assert!(crate::core::node::validate_node(&bad.root).unwrap_err().contains("unknown primitive 'iframe'"));
        assert!(parse_view(r#"{"root": {"kind": "stack"}}"#).unwrap_err().contains("no path"));
        assert!(view_prompt("a page").contains("sessions"));
    }

    #[test]
    fn a_room_left_mid_step_by_a_restart_says_so() {
        let st = room(Rule::Round);
        say(&st, "rooms", 1, "begin").unwrap();
        recover(&st, "rooms");
        let r = get(&st, "rooms", 1).unwrap();
        assert!(r.state == State::Failed && r.error.contains("restarted"));
    }
}
