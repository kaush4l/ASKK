//! FEATURE: kanban board tools — add/list/move/check over `BoardStore`
//! (runtime/src/state/board.rs); pure card model in core/src/board.rs; UI
//! stages ui/board.rs + ui/dashboard.rs; digest feeds run/live.rs BOARD block.
//!
//! Board tools: how agents work the kanban board (ADR-026). `board_add`
//! creates cards from a plan, `board_list` reads the board, `board_move`
//! pushes a card to its next stage (Done is criteria-gated in core),
//! `board_check` records per-criterion verdicts. Mutations persist, so the
//! three writers are `Effect::Mutating` and honor `ctx.dry_run`.

use std::rc::Rc;

use askk_core::{Card, CardStage, Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use futures::future::LocalBoxFuture;
use serde_json::{json, Value};

use super::registry::{RegistryError, ToolRegistry};
use askk_state::{BoardStore, KvStore};

/// Registers the four board tools over the given store.
pub fn register_board(reg: &mut ToolRegistry, kv: Rc<dyn KvStore>) -> Result<(), RegistryError> {
    reg.register(Rc::new(BoardAdd {
        spec: add_spec(),
        board: BoardStore::new(kv.clone()),
    }))?;
    reg.register(Rc::new(BoardList {
        spec: list_spec(),
        board: BoardStore::new(kv.clone()),
    }))?;
    reg.register(Rc::new(BoardMove {
        spec: move_spec(),
        board: BoardStore::new(kv.clone()),
    }))?;
    reg.register(Rc::new(BoardCheck {
        spec: check_spec(),
        board: BoardStore::new(kv),
    }))
}

fn line(card: &Card) -> String {
    let met = card.criteria.iter().filter(|c| c.met).count();
    let who = if card.assignee.is_empty() {
        String::new()
    } else {
        format!(" @{}", card.assignee)
    };
    format!(
        "- [{}] {}{who} ({met}/{} criteria)",
        card.id,
        card.title,
        card.criteria.len()
    )
}

struct BoardAdd {
    spec: ToolSpec,
    board: BoardStore,
}

fn add_spec() -> ToolSpec {
    ToolSpec {
        name: "board_add".into(),
        description: "Adds a task card to the kanban board: title, goal, and \
                      the acceptance criteria that must all be met to finish."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "goal": { "type": "string", "description": "Self-contained work description." },
                "criteria": { "type": "array", "items": { "type": "string" },
                              "description": "Acceptance criteria; every one must be met to finish." },
                "stage": { "type": "string", "description": "backlog (default) | planning | doing | testing" }
            },
            "required": ["title"]
        }),
        effect: Effect::Mutating,
    }
}

impl Tool for BoardAdd {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(title) = args.get("title").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("board_add: missing string field 'title'");
            };
            if title.is_empty() {
                return ToolResult::err("board_add: 'title' is empty");
            }
            let goal = args.get("goal").and_then(Value::as_str).unwrap_or("");
            let stage = match args.get("stage").and_then(Value::as_str) {
                None => CardStage::Backlog,
                Some(s) => match CardStage::parse(s) {
                    Some(CardStage::Done) => {
                        return ToolResult::err("board_add: new cards cannot start done")
                    }
                    Some(st) => st,
                    None => return ToolResult::err(format!("board_add: unknown stage '{s}'")),
                },
            };
            let criteria: Vec<String> = args
                .get("criteria")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            if ctx.dry_run {
                return ToolResult::ok(format!(
                    "would add '{title}' to {} ({} criteria)",
                    stage.name(),
                    criteria.len()
                ));
            }
            match self.board.add(title, goal, criteria, stage).await {
                Ok(card) => ToolResult::ok(format!(
                    "added [{}] '{}' to {} ({} criteria)",
                    card.id,
                    card.title,
                    card.stage.name(),
                    card.criteria.len()
                )),
                Err(e) => ToolResult::err(format!("board_add: store: {e}")),
            }
        })
    }
}

struct BoardList {
    spec: ToolSpec,
    board: BoardStore,
}

fn list_spec() -> ToolSpec {
    ToolSpec {
        name: "board_list".into(),
        description: "Reads the kanban board: no arguments = every card by \
                      stage; an id = the full card with criteria and notes."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Card id for the detailed view." }
            }
        }),
        effect: Effect::Pure,
    }
}

impl Tool for BoardList {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            if let Some(id) = args.get("id").and_then(Value::as_str) {
                return match self.board.get(id.trim()).await {
                    Ok(Some(card)) => ToolResult::ok(detail(&card)),
                    Ok(None) => ToolResult::err(format!("board_list: no card '{id}'")),
                    Err(e) => ToolResult::err(format!("board_list: store: {e}")),
                };
            }
            match self.board.list().await {
                Ok(cards) if cards.is_empty() => ToolResult::ok("the board is empty"),
                Ok(cards) => {
                    let mut out = String::new();
                    for stage in CardStage::ALL {
                        let in_stage: Vec<&Card> =
                            cards.iter().filter(|c| c.stage == stage).collect();
                        if in_stage.is_empty() {
                            continue;
                        }
                        out.push_str(&format!("## {}\n", stage.name()));
                        for card in in_stage {
                            out.push_str(&line(card));
                            out.push('\n');
                        }
                    }
                    ToolResult::ok(out.trim_end().to_string())
                }
                Err(e) => ToolResult::err(format!("board_list: store: {e}")),
            }
        })
    }
}

fn detail(card: &Card) -> String {
    let mut out = format!(
        "[{}] {} — {}\ngoal: {}\n",
        card.id,
        card.title,
        card.stage.name(),
        if card.goal.is_empty() {
            "-"
        } else {
            &card.goal
        }
    );
    if !card.assignee.is_empty() {
        out.push_str(&format!("assignee: {}\n", card.assignee));
    }
    if let Some(run) = &card.run_id {
        out.push_str(&format!("run: {run}\n"));
    }
    for (i, c) in card.criteria.iter().enumerate() {
        out.push_str(&format!(
            "{}. [{}] {}\n",
            i + 1,
            if c.met { "x" } else { " " },
            c.text
        ));
    }
    if !card.note.is_empty() {
        out.push_str(&format!("notes: {}\n", card.note));
    }
    out.trim_end().to_string()
}

struct BoardMove {
    spec: ToolSpec,
    board: BoardStore,
}

fn move_spec() -> ToolSpec {
    ToolSpec {
        name: "board_move".into(),
        description: "Moves a card to another stage (backlog|planning|doing|\
                      testing|done). Done is refused while any criterion is \
                      unmet — bounce back to planning and note why instead."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "stage": { "type": "string" },
                "assignee": { "type": "string", "description": "Agent now responsible (optional)." },
                "note": { "type": "string", "description": "Why the card moved (optional)." }
            },
            "required": ["id", "stage"]
        }),
        effect: Effect::Mutating,
    }
}

impl Tool for BoardMove {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(id) = args.get("id").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("board_move: missing string field 'id'");
            };
            let Some(stage) = args
                .get("stage")
                .and_then(Value::as_str)
                .and_then(CardStage::parse)
            else {
                return ToolResult::err(
                    "board_move: 'stage' must be backlog|planning|doing|testing|done",
                );
            };
            let mut card = match self.board.get(id).await {
                Ok(Some(card)) => card,
                Ok(None) => return ToolResult::err(format!("board_move: no card '{id}'")),
                Err(e) => return ToolResult::err(format!("board_move: store: {e}")),
            };
            if let Err(reason) = card.may_enter(stage) {
                return ToolResult::err(format!("board_move: {reason}"));
            }
            if ctx.dry_run {
                return ToolResult::ok(format!("would move [{id}] to {}", stage.name()));
            }
            let from = card.stage;
            card.stage = stage;
            if let Some(who) = args.get("assignee").and_then(Value::as_str) {
                card.assignee = who.trim().to_string();
            }
            if let Some(note) = args.get("note").and_then(Value::as_str) {
                if !card.note.is_empty() {
                    card.note.push_str(" | ");
                }
                card.note.push_str(note.trim());
            }
            match self.board.put(&card).await {
                Ok(()) => {
                    ToolResult::ok(format!("moved [{id}] {} -> {}", from.name(), stage.name()))
                }
                Err(e) => ToolResult::err(format!("board_move: store: {e}")),
            }
        })
    }
}

struct BoardCheck {
    spec: ToolSpec,
    board: BoardStore,
}

fn check_spec() -> ToolSpec {
    ToolSpec {
        name: "board_check".into(),
        description: "Records a verdict on one acceptance criterion: met or \
                      unmet, with an evidence note. Pick the criterion by \
                      number (board_list) or a unique substring."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "criterion": { "type": ["integer", "string"],
                               "description": "1-based number, or unique substring of the criterion text." },
                "met": { "type": "boolean", "description": "Default true." },
                "note": { "type": "string", "description": "Evidence / reason (optional)." }
            },
            "required": ["id", "criterion"]
        }),
        effect: Effect::Mutating,
    }
}

/// Resolves a criterion reference: 1-based index, numeric string, or a
/// substring that matches exactly one criterion.
fn find_criterion(card: &Card, wanted: &Value) -> Result<usize, String> {
    let by_index = |n: usize| -> Result<usize, String> {
        if n >= 1 && n <= card.criteria.len() {
            Ok(n - 1)
        } else {
            Err(format!(
                "criterion {n} out of range (card has {})",
                card.criteria.len()
            ))
        }
    };
    if let Some(n) = wanted.as_u64() {
        return by_index(n as usize);
    }
    let Some(text) = wanted.as_str().map(str::trim) else {
        return Err("'criterion' must be a number or string".into());
    };
    if let Ok(n) = text.parse::<usize>() {
        return by_index(n);
    }
    let needle = text.to_ascii_lowercase();
    let hits: Vec<usize> = card
        .criteria
        .iter()
        .enumerate()
        .filter(|(_, c)| c.text.to_ascii_lowercase().contains(&needle))
        .map(|(i, _)| i)
        .collect();
    match hits.as_slice() {
        [one] => Ok(*one),
        [] => Err(format!("no criterion matches '{text}'")),
        _ => Err(format!(
            "'{text}' matches {} criteria — be specific",
            hits.len()
        )),
    }
}

impl Tool for BoardCheck {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(id) = args.get("id").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("board_check: missing string field 'id'");
            };
            let Some(wanted) = args.get("criterion") else {
                return ToolResult::err("board_check: missing field 'criterion'");
            };
            let mut card = match self.board.get(id).await {
                Ok(Some(card)) => card,
                Ok(None) => return ToolResult::err(format!("board_check: no card '{id}'")),
                Err(e) => return ToolResult::err(format!("board_check: store: {e}")),
            };
            let idx = match find_criterion(&card, wanted) {
                Ok(i) => i,
                Err(e) => return ToolResult::err(format!("board_check: {e}")),
            };
            let met = args.get("met").and_then(Value::as_bool).unwrap_or(true);
            if ctx.dry_run {
                return ToolResult::ok(format!(
                    "would mark criterion {} of [{id}] {}",
                    idx + 1,
                    if met { "met" } else { "unmet" }
                ));
            }
            card.criteria[idx].met = met;
            if let Some(note) = args.get("note").and_then(Value::as_str) {
                if !card.note.is_empty() {
                    card.note.push_str(" | ");
                }
                card.note.push_str(note.trim());
            }
            let remaining = card.criteria.iter().filter(|c| !c.met).count();
            match self.board.put(&card).await {
                Ok(()) => ToolResult::ok(format!(
                    "criterion {} of [{id}] {}; {remaining} unmet remain",
                    idx + 1,
                    if met { "met" } else { "unmet" }
                )),
                Err(e) => ToolResult::err(format!("board_check: store: {e}")),
            }
        })
    }
}
