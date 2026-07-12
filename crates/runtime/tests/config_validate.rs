//! Layer-4 tests for `config::validate` — moved out of the src file to
//! honor the ADR-012 line cap (tests are exempt in tests/).

use askk_runtime::config::agent::AgentConfig;
use askk_runtime::config::team::TeamConfig;
use askk_runtime::config::validate;

mod tests {
    use super::*;

    fn strs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn agent(id: &str, text: &str) -> AgentConfig {
        AgentConfig::from_markdown(&format!("agents/{id}.md"), text).unwrap()
    }

    #[test]
    fn valid_set_passes() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: read\nskills: concise\nphase.1.name: plan\nphase.1.contract: plan\nphase.2.name: verify\nphase.2.contract: critique\nphase.2.gate: true\nphase.2.on_fail: plan\nphase.2.tools: read\n---\n",
        );
        validate(
            &[a],
            &[],
            &strs(&["read"]),
            &strs(&["concise"]),
            &strs(&["react", "plan", "critique"]),
            &strs(&["default"]),
        )
        .unwrap();
    }

    #[test]
    fn every_unknown_ref_lands_in_one_error() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: ghost_tool\nskills: ghost_skill\nphase.1.name: plan\nphase.2.name: verify\nphase.2.gate: true\nphase.2.on_fail: nowhere\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("unknown tool 'ghost_tool'"));
        assert!(joined.contains("unknown skill 'ghost_skill'"));
        assert!(joined.contains("on_fail target 'nowhere' names no phase"));
        assert_eq!(err.problems.len(), 3);
    }

    #[test]
    fn duplicate_ids_and_bad_slugs_are_errors() {
        let a = agent("coder", "---\nid: coder\n---\n");
        let mut b = agent("coder2", "---\nid: coder\n---\n");
        b.id = "coder".into();
        let mut c = agent("bad", "---\nid: bad\n---\n");
        c.id = "Bad Slug!".into();
        let err = validate(
            &[a, b, c],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("duplicate agent id 'coder'"));
        assert!(joined.contains("also declared in agents/coder.md"));
        assert!(joined.contains("'Bad Slug!' is not a slug"));
    }

    #[test]
    fn two_gate_phases_are_rejected() {
        let a = agent(
            "coder",
            "---\nid: coder\nphase.1.name: a\nphase.1.gate: true\nphase.2.name: b\nphase.2.gate: true\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("at most one gate phase"));
    }

    #[test]
    fn phase_tools_must_subset_agent_tools() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: read\nphase.1.name: p\nphase.1.tools: write\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&["read", "write"]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("'write' is not in the agent's tools"));
    }

    #[test]
    fn on_fail_must_target_an_earlier_phase() {
        // Gate naming itself, and a phase naming a LATER phase: both are
        // misrouted rewinds answer routing could never take — reject loud.
        let a = agent(
            "selfref",
            "---\nid: selfref\nphase.1.name: plan\nphase.2.name: verify\n\
             phase.2.gate: true\nphase.2.on_fail: verify\n---\n",
        );
        let b = agent(
            "late",
            "---\nid: late\nphase.1.name: check\nphase.1.on_fail: fix\n\
             phase.2.name: fix\n---\n",
        );
        let err = validate(
            &[a, b],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(
            joined.contains("phase 'verify' on_fail target 'verify' must name an earlier phase")
        );
        assert!(joined.contains("phase 'check' on_fail target 'fix' must name an earlier phase"));
        assert_eq!(err.problems.len(), 2);
    }

    /// A complete custom contract (action/answer/verdict) is accepted at
    /// agent level, on phases, and on a gate.
    #[test]
    fn valid_custom_contract_passes() {
        let a = agent(
            "own",
            "---\nid: own\ntools: read\ncontract: own\n\
             field.1.name: action\nfield.1.kind: enum: tool|answer\n\
             field.2.name: answer\nfield.2.required: false\n\
             field.3.name: verdict\nfield.3.kind: enum: pass|revise\nfield.3.required: false\n\
             phase.1.name: work\nphase.1.contract: own\n\
             phase.2.name: check\nphase.2.contract: own\nphase.2.gate: true\n---\n",
        );
        validate(
            &[a],
            &[],
            &strs(&["read"]),
            &strs(&[]),
            &strs(&["react", "plan", "critique"]),
            &strs(&["default"]),
        )
        .unwrap();
    }

    #[test]
    fn custom_contract_with_tools_needs_action_and_answer() {
        // Active custom contract, tools present, but only a `notes` field.
        let a = agent(
            "own",
            "---\nid: own\ntools: read\ncontract: own\nfield.1.name: notes\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&["read"]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("no `action` enum field containing tool|answer"));
        assert!(joined.contains("no `answer` field"));
        assert_eq!(err.problems.len(), 2);
    }

    #[test]
    fn custom_contract_on_gate_needs_verdict() {
        let a = agent(
            "own",
            "---\nid: own\ncontract: react\nfield.1.name: score\n\
             phase.1.name: work\nphase.2.name: check\nphase.2.contract: own\n\
             phase.2.gate: true\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("no `verdict` enum field containing pass|revise"));
    }

    /// Custom contracts are agent-local: another agent referencing one is an
    /// unknown contract (resolve_contract could never honor it at runtime).
    #[test]
    fn custom_contracts_do_not_leak_across_agents() {
        let a = agent("owner", "---\nid: owner\nfield.1.name: notes\n---\n");
        let b = agent("thief", "---\nid: thief\ncontract: owner\n---\n");
        let err = validate(
            &[a, b],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("unknown contract 'owner'"));
        assert_eq!(err.problems.len(), 1);
    }

    #[test]
    fn fan_out_refs_are_checked() {
        // ghost tool + parts naming a non-List field of the previous contract.
        let a = agent(
            "fan",
            "---\nid: fan\ntools: worker\nphase.1.name: plan\nphase.1.contract: plan\n\
             phase.2.name: out\nphase.2.fan_out: ghost\nphase.2.parts: rationale\n---\n",
        );
        // fan_out on the first phase + fan_out without parts.
        let b = agent(
            "first",
            "---\nid: first\ntools: worker\nphase.1.name: out\nphase.1.fan_out: worker\n\
             phase.1.parts: steps\nphase.2.name: half\nphase.2.fan_out: worker\n---\n",
        );
        let err = validate(
            &[a, b],
            &[],
            &strs(&["worker", "ghost"]),
            &strs(&[]),
            &strs(&["react", "plan"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("fan_out tool 'ghost' is not in the agent's tools"));
        assert!(joined.contains("parts 'rationale' is not a List field"));
        assert!(joined.contains("has no previous phase"));
        assert!(joined.contains("needs both `fan_out` and `parts`"));
        assert_eq!(err.problems.len(), 4);
    }

    #[test]
    fn unknown_contract_and_provider_are_errors() {
        let a = agent(
            "a",
            "---\nid: a\ncontract: mystery\nprovider: nobody\n---\n",
        );
        let err = validate(
            &[a],
            &[],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("unknown contract 'mystery'"));
        assert!(joined.contains("unknown provider 'nobody'"));
    }
}

mod team_tests {
    use super::*;

    fn strs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn agent(path: &str, id: &str) -> AgentConfig {
        AgentConfig::from_markdown(path, &format!("---\nid: {id}\n---\n")).unwrap()
    }

    #[test]
    fn valid_team_passes() {
        let team = TeamConfig::from_markdown(
            "agents/coding/team.md",
            "---\nid: coding\nlead: dev-lead\ntools: shell\n---\nDRY.",
        )
        .unwrap();
        let members = vec![
            agent("agents/coding/dev-lead.md", "dev-lead"),
            agent("agents/coding/programmer.md", "programmer"),
        ];
        validate(
            &members,
            &[team],
            &strs(&["shell"]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap();
    }

    #[test]
    fn team_problems_all_land_in_one_error() {
        // Lead missing from folder, unknown tool, id colliding with an agent,
        // nested too deep — every problem reported.
        let team = TeamConfig::from_markdown(
            "agents/a/b/team.md",
            "---\nid: solo\nlead: ghost\ntools: warp\n---\n",
        )
        .unwrap();
        let a = agent("agents/solo.md", "solo");
        let err = validate(
            &[a],
            &[team],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("duplicate id 'solo'"));
        assert!(joined.contains("unknown tool 'warp'"));
        assert!(joined.contains("team-in-team is not supported yet"));
        assert!(joined.contains("team folder holds no agents"));
        assert!(joined.contains("lead 'ghost' is not an agent in agents/a/b/"));
    }
}
