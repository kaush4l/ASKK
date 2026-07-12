//! Skill discovery tools — progressive disclosure over the loaded
//! `agents/skills/*.md` set: `skill_list` is the cheap L1 index, `skill_read`
//! loads one full body on demand, so an agent can PICK skills at runtime
//! instead of carrying every body via static `skills:` frontmatter. Pure
//! reads over session config; opt-in via explicit `tools:` (no env preset).
//! Skill bodies are repo-shipped config — same trust tier as agent bodies —
//! so observations carry them plain (no untrusted wrapper).

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::config::SkillConfig;

use super::registry::{RegistryError, RustTool, ToolRegistry};

/// Registers both discovery tools over the loaded skill set. Listing order
/// is the load (manifest) order of `skills`.
pub fn register_skills(
    reg: &mut ToolRegistry,
    skills: &[SkillConfig],
) -> Result<(), RegistryError> {
    let skills: Rc<[SkillConfig]> = skills.into();
    reg.register(list_tool(Rc::clone(&skills)))?;
    reg.register(read_tool(skills))
}

/// First non-empty body line, for the one-row-per-skill index.
fn first_line(body: &str) -> &str {
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
}

fn list_tool(skills: Rc<[SkillConfig]>) -> Rc<dyn Tool> {
    RustTool::shared(
        ToolSpec {
            name: "skill_list".into(),
            description: "Lists every loaded skill as an index (id — name — \
                          first line). Cheap; load a full body on demand with \
                          skill_read."
                .into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            effect: Effect::Pure,
        },
        move |_args, _ctx| {
            if skills.is_empty() {
                return ToolResult::ok("(no skills loaded)");
            }
            let lines: Vec<String> = skills
                .iter()
                .map(|s| format!("* {} — {} — {}", s.id, s.name, first_line(&s.body)))
                .collect();
            ToolResult::ok(lines.join("\n"))
        },
    )
}

fn read_tool(skills: Rc<[SkillConfig]>) -> Rc<dyn Tool> {
    RustTool::shared(
        ToolSpec {
            name: "skill_read".into(),
            description: "Reads one loaded skill's full body by id (ids come \
                          from skill_list)."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Skill id from skill_list." }
                },
                "required": ["id"]
            }),
            effect: Effect::Pure,
        },
        move |args, _ctx| {
            let Some(id) = args.get("id").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("skill_read: missing string field 'id'");
            };
            match skills.iter().find(|s| s.id == id) {
                Some(s) => ToolResult::ok(format!("# {}\n\n{}", s.name, s.body)),
                None => {
                    let ids: Vec<&str> = skills.iter().map(|s| s.id.as_str()).collect();
                    ToolResult::err(format!(
                        "unknown skill '{id}'; loaded skills: [{}]. Use \
                         skill_list to see them.",
                        ids.join(", ")
                    ))
                }
            }
        },
    )
}
