//! Layer-4 config tests (docs/TESTING.md): every markdown file under
//! `agents/` — soul, skills, agents (incl. team subfolders) — parses and
//! validates in CI. The smoke test that constructs every agent: a config
//! nothing imports must still fail loudly here.

use std::fs;
use std::path::{Path, PathBuf};

use askk_core::contracts;
use askk_runtime::config::{load_soul, validate, AgentConfig, SkillConfig, TeamConfig};

fn agents_dir() -> PathBuf {
    // The agents folder lives under the web crate's served assets so the same
    // files are baked AND served verbatim at `/assets/agents/*`.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/assets/agents")
}

fn md_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("readable directory") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "md") {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn every_agent_file_parses_and_validates() {
    let root = agents_dir();
    assert!(root.is_dir(), "agents/ missing at {}", root.display());

    let mut agents: Vec<AgentConfig> = Vec::new();
    let mut teams: Vec<TeamConfig> = Vec::new();
    let mut skills: Vec<SkillConfig> = Vec::new();
    let mut soul: Option<String> = None;
    for path in md_files(&root) {
        let rel = path.strip_prefix(&root).expect("under agents/");
        let label = format!("agents/{}", rel.display());
        let text = fs::read_to_string(&path).expect("readable file");
        if rel.file_name().is_some_and(|n| n == "README.md") {
            continue; // folder docs, not config (build.rs skips it too)
        } else if rel == Path::new("soul.md") {
            soul = Some(load_soul(&text));
        } else if rel.file_name().is_some_and(|n| n == "team.md") {
            teams.push(TeamConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        } else if rel.starts_with("skills") {
            skills
                .push(SkillConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        } else {
            agents
                .push(AgentConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        }
    }
    assert!(!agents.is_empty(), "no agent.md files found — glob broken?");
    assert!(
        !soul.expect("agents/soul.md missing").is_empty(),
        "soul.md is empty"
    );

    // ponytail: the tool registry + provider profiles land in later waves;
    // until then the tool/provider universe is derived from the files
    // themselves, so shape checks (dupes, slugs, gates, on_fail, contracts,
    // skills, phase-tool subsetting) still bite in CI.
    let mut known_tools: Vec<String> = Vec::new();
    let mut known_providers: Vec<String> = Vec::new();
    for agent in &agents {
        known_tools.extend(agent.tools.iter().cloned());
        known_providers.push(agent.provider.clone());
    }
    for team in &teams {
        known_tools.extend(team.tools.iter().cloned());
    }
    let known_skills: Vec<String> = skills.iter().map(|s| s.id.clone()).collect();
    let known_contracts: Vec<String> = contracts::NAMES.iter().map(|n| n.to_string()).collect();

    if let Err(e) = validate(
        &agents,
        &teams,
        &known_tools,
        &known_skills,
        &known_contracts,
        &known_providers,
    ) {
        panic!("{e}");
    }
}

// --- unit tests moved from src/config/agent.rs (ADR-012 line cap; the
// validate.rs tests made the same move to tests/config_validate.rs) ---

mod agent_md {
    use askk_core::{Budgets, LoopMode, OutputMode};
    use askk_runtime::config::agent::{BudgetOverride, DEFAULT_LOOP_MAX_TURNS};
    use askk_runtime::config::{load_soul, AgentConfig, SkillConfig};

    /// docs/MODELS.md §Agent configuration, verbatim.
    const MODELS_MD_EXAMPLE: &str = "\
---
id: coder                # slug, unique, validated
name: Coder
description: ...         # doubles as the tool card when delegated to
enabled: true
tools: file_read, file_write, run_js        # names resolved at load; unknown = hard error
skills: concise                              # resolved at load; unknown = hard error
provider: default                            # provider profile id
contract: react                              # named contract (default: react)
format: toon                                 # initial output mode
budget.max_turns: 64                         # optional budget.* overrides of the session budgets
budget.deadline_s: 1800                      # wall clock, seconds (stored as ms)
budget.depth: 3                              # delegation depth cap, 1..=8 (runaway guard)
phase.1.name: plan                           # optional phases → DeclaredStrategy
phase.1.contract: plan
phase.1.loop: one_shot
phase.2.name: execute
phase.2.contract: react
phase.2.loop: loop
phase.3.name: verify
phase.3.contract: critique
phase.3.gate: true
phase.3.on_fail: plan
---
(markdown body = the directive/role prompt)
";

    #[test]
    fn models_md_example_parses_verbatim() {
        let cfg = AgentConfig::from_markdown("agents/coder.md", MODELS_MD_EXAMPLE).unwrap();
        assert_eq!(cfg.id, "coder");
        assert_eq!(cfg.name, "Coder");
        assert!(cfg.enabled);
        assert_eq!(cfg.tools, vec!["file_read", "file_write", "run_js"]);
        assert_eq!(cfg.skills, vec!["concise"]);
        assert_eq!(cfg.provider, "default");
        assert_eq!(cfg.contract, "react");
        assert_eq!(cfg.format, OutputMode::Toon);
        assert_eq!(
            cfg.budget,
            BudgetOverride {
                max_turns: Some(64),
                deadline_ms: Some(1_800_000),
                depth: Some(3),
            }
        );
        assert_eq!(cfg.body, "(markdown body = the directive/role prompt)");
        assert_eq!(cfg.phases.len(), 3);
        assert_eq!(cfg.phases[0].name, "plan");
        assert_eq!(cfg.phases[0].contract, "plan");
        assert_eq!(cfg.phases[0].loop_mode, LoopMode::OneShot);
        assert!(!cfg.phases[0].gate);
        assert_eq!(
            cfg.phases[1].loop_mode,
            LoopMode::Loop {
                max_turns: DEFAULT_LOOP_MAX_TURNS
            }
        );
        assert_eq!(cfg.phases[2].name, "verify");
        assert!(cfg.phases[2].gate);
        assert_eq!(cfg.phases[2].on_fail.as_deref(), Some("plan"));
        assert_eq!(cfg.phases[2].loop_mode, LoopMode::OneShot); // default
    }

    #[test]
    fn minimal_agent_gets_defaults() {
        let cfg = AgentConfig::from_markdown("a.md", "---\nid: mini\n---\nBody.").unwrap();
        assert_eq!(cfg.name, "mini"); // name defaults to id
        assert!(cfg.enabled);
        assert!(cfg.tools.is_empty());
        assert_eq!(cfg.provider, "default");
        assert_eq!(cfg.contract, "react");
        assert_eq!(cfg.format, OutputMode::Toon);
        assert!(cfg.phases.is_empty());
        assert_eq!(cfg.budget, BudgetOverride::default()); // no declared budget
        assert_eq!(cfg.body, "Body.");
    }

    #[test]
    fn unknown_keys_fail_loud_with_line_numbers() {
        let err = AgentConfig::from_markdown("a.md", "---\nid: a\ncolour: red\n---\n").unwrap_err();
        assert_eq!(err.problems.len(), 1);
        assert!(err.problems[0].contains("a.md:3"));
        assert!(err.problems[0].contains("unknown key 'colour'"));
    }

    #[test]
    fn bad_values_are_collected_into_one_error() {
        let text = "---\nenabled: yep\nformat: xml\nphase.1.name: p\nphase.1.loop: forever\nphase.1.gate: maybe\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("`enabled` must be true|false"));
        assert!(joined.contains("`format` must be json|toon|text"));
        assert!(joined.contains("`loop` must be one_shot|loop"));
        assert!(joined.contains("`gate` must be true|false"));
        assert!(joined.contains("missing required key `id`"));
        assert_eq!(err.problems.len(), 5);
    }

    #[test]
    fn phase_gaps_and_missing_names_are_errors() {
        let text = "---\nid: a\nphase.1.name: plan\nphase.3.contract: react\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("missing phase.2"));
        assert!(joined.contains("missing `phase.3.name`"));
    }

    #[test]
    fn malformed_phase_keys_are_errors() {
        let text = "---\nid: a\nphase.x.name: p\nphase.1.speed: fast\nphase.one: p\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("phase number must be an integer"));
        assert!(joined.contains("unknown phase field 'speed'"));
        assert!(joined.contains("phase.<n>.<field>"));
    }

    #[test]
    fn max_turns_feeds_the_loop_clamp() {
        let text = "---\nid: a\nphase.1.name: work\nphase.1.loop: loop\nphase.1.max_turns: 4\n\
                    phase.2.name: more\nphase.2.max_turns: 2\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        assert_eq!(cfg.phases[0].loop_mode, LoopMode::Loop { max_turns: 4 });
        // max_turns alone implies `loop: loop`.
        assert_eq!(cfg.phases[1].loop_mode, LoopMode::Loop { max_turns: 2 });
    }

    #[test]
    fn max_turns_rejects_one_shot_and_bad_values() {
        let text = "---\nid: a\nphase.1.name: p\nphase.1.loop: one_shot\nphase.1.max_turns: 3\n\
                    phase.2.name: q\nphase.2.max_turns: zero\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("`max_turns` requires `loop: loop`"));
        assert!(joined.contains("`max_turns` must be a positive integer"));
    }

    #[test]
    fn fan_out_and_parts_land_on_the_phase() {
        let text = "---\nid: a\ntools: worker\nphase.1.name: plan\nphase.1.contract: plan\n\
                    phase.2.name: fan\nphase.2.fan_out: worker\nphase.2.parts: steps\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        assert_eq!(cfg.phases[1].fan_out.as_deref(), Some("worker"));
        assert_eq!(cfg.phases[1].parts.as_deref(), Some("steps"));
        assert_eq!(cfg.phases[0].fan_out, None);
    }

    #[test]
    fn phase_tools_narrow_the_allowlist() {
        let text = "---\nid: a\ntools: x, y\nphase.1.name: p\nphase.1.tools: x\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        assert_eq!(cfg.phases[0].tool_filter, Some(vec!["x".to_string()]));
    }

    #[test]
    fn env_presets_expand_and_union_with_tools() {
        // `shell` is already in `vm` (deduped); `fetch_url` is an extra.
        let text = "---\nid: a\nenv: vm\ntools: fetch_url, shell\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        let want = [
            "shell",
            "write_file",
            "read_file",
            "list_files",
            "edit_file",
            "fetch_url",
        ];
        assert_eq!(cfg.tools, want);
        // env alone == the hand-written equivalent list.
        let by_env = AgentConfig::from_markdown("a.md", "---\nid: a\nenv: core\n---\n").unwrap();
        let by_hand =
            AgentConfig::from_markdown("a.md", "---\nid: a\ntools: calc, now, js_eval\n---\n")
                .unwrap();
        assert_eq!(by_env.tools, by_hand.tools);
    }

    #[test]
    fn unknown_env_preset_joins_the_other_problems() {
        let text = "---\nenv: vm, matrix\nformat: xml\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("a.md:2: unknown env preset 'matrix'"));
        assert!(joined.contains("`format` must be json|toon|text"));
        assert!(joined.contains("missing required key `id`"));
        assert_eq!(err.problems.len(), 3);
    }

    #[test]
    fn skill_config_parses_and_projects() {
        let skill = SkillConfig::from_markdown(
            "agents/skills/concise.md",
            "---\nid: concise\nname: Concise\n---\nBe brief.",
        )
        .unwrap();
        assert_eq!(skill.id, "concise");
        let projected = skill.to_skill();
        assert_eq!(projected.name, "Concise");
        assert_eq!(projected.body, "Be brief.");
        let err = SkillConfig::from_markdown("s.md", "---\nname: X\nfoo: y\n---\n").unwrap_err();
        assert_eq!(err.problems.len(), 2); // unknown key + missing id
    }

    #[test]
    fn load_soul_trims_plain_markdown() {
        assert_eq!(load_soul("\n# Soul\ntext\n\n"), "# Soul\ntext");
    }

    /// `budget.*` keys parse into the override and compose over session
    /// budgets: declared fields win, everything else passes through.
    #[test]
    fn budget_keys_parse_and_apply_over_session_defaults() {
        let text = "---\nid: director\nbudget.max_turns: 64\n\
                    budget.deadline_s: 1800\nbudget.depth: 3\n---\nLong thread.";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        assert_eq!(cfg.budget.max_turns, Some(64));
        assert_eq!(cfg.budget.deadline_ms, Some(1_800_000)); // seconds → ms
        assert_eq!(cfg.budget.depth, Some(3));
        let resolved = cfg.budget.apply(Budgets::default());
        assert_eq!(resolved.max_turns, 64);
        assert_eq!(resolved.deadline_ms, 1_800_000);
        assert_eq!(resolved.max_delegation_depth, 3);
        // Undeclared fields keep the session values.
        let base = Budgets::default();
        assert_eq!(resolved.tool_timeout_ms, base.tool_timeout_ms);
        assert_eq!(resolved.max_context_chars, base.max_context_chars);
        // No override at all = identity.
        assert_eq!(BudgetOverride::default().apply(base), base);
    }
}
