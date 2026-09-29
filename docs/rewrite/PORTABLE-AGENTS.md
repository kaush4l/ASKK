# Import a folder-defined agent

The dashboard's **Import agent** button loads a declarative folder into the
current browser. The definition, model mapping, selected lead, and approved tool
groups are saved in IndexedDB before activation. Installation does not run an
agent task. Imported JavaScript and other executable source are rejected.

The current source also compiles the shipped catalogue through this validator and
compiler. [Unified agent packages](UNIFIED-AGENT-PACKAGES.md) describes the exact
desk configuration, service lifecycle and migration boundary; release-specific
build and browser evidence is recorded separately.

1. Configure and test the desk's model connection. Safari with an HTTP loopback
   model should use the trusted HTTPS model relay described in the README.
2. Select **Import agent → Choose an agent folder**. Select a folder containing
   `agent.md` at its root. A standalone `agent.md` can use the single-file picker
   when it needs no supporting files.
3. Review all roles and select any role as the lead. Map each authored model alias
   to a saved desk profile. A missing `model` field appears as **Default model**;
   it still needs an explicit profile mapping.
4. Check the requested tool groups you want to allow. All begin unchecked. Each
   role receives only the intersection of its requests and these grants. Existing
   desk denials and approval requirements still apply.
5. Select **Install agent**. The direct workflow for your chosen lead becomes
   selected. Declared package workflows appear as additional options; their
   manifest default never overrides your lead selection. Enter a goal and start
   it. Inspect its recorded prompts and actual tool results.

Try the [`examples/pond-team`](../../examples/pond-team) folder. Select **Pond
observer** as lead, map its default model to `workbench`, and approve `todo`.
Ask: “Read the current task plan with todo_read, then tell me whether it is empty.”
This task needs neither Browser Linux nor native execution. Choosing **Pond
guide** instead enables its configured `observe` delegate.

## Minimal definition

```yaml
---
package_id: my.first-agent
package_version: 1.0.0
id: helper
name: My helper
description: Answers questions using the current task plan.
tools: [todo]
session: task
max_steps: 8
---
Answer concisely. Read the current task plan when it is relevant. Report only
actions confirmed by a tool result.
```

The root supplies `package_id`, semantic `package_version`, and a stable role
`id`. Each nested `agent.md` supplies its own unique `id`. Folder names and
display names do not determine identity. `agents: {review: reviewer_id}` gives a
role a package-local delegation tool named `review`. That target must exist in
the same folder package. The desk enforces its delegation and budget policy.

Task sessions are the default; `session: agent` explicitly retains conversation
history. Optional `services: {compaction: digest, retrospective: reflect}` refers
to other local role IDs. Compaction targets must request no tools, delegates,
services, skills or verification. Invalid/self/cyclic service references fail
validation. Names such as `main` or `compactor` have no special runtime authority.

Imported private memory and prior-session lookup are scoped to the installation
and role. Imported `shared` memory is limited to the current package task, so it
does not expose the desk's global shared notes. Scheduled work is not supported
for imports yet because deferred tasks cannot retain all required bindings.

Local `soul.md` and `learned.md` accompany the role whose folder contains them.
`prompt_template` and explicit `skills` paths are relative to the **package root**,
including references authored by a nested role.
Shared parent instructions are not inherited implicitly. Authored source remains
unchanged and SHA-256 checked. Credentials and transport settings belong in the
desk, never in a package.

## Portable workflows

A root definition can add `workflows: workflows.json`. The manifest declares a
default and 1–32 workflows. Each workflow names a package-local strategy JSON
file, an explicit workspace requirement and trusted completion checks:

```json
{
  "version": 1,
  "default": "conversation",
  "workflows": [{
    "id": "conversation",
    "label": "Talk with the team",
    "description": "Answer with the configured roles.",
    "strategy": "strategies/conversation.json",
    "execution": {"workspace": "none"},
    "completion": {"checks": []}
  }]
}
```

An agent strategy uses a local role ID, for example
`{"version":1,"id":"conversation","kind":"agent","agent":"helper","delegation":"declared","session":"agent"}`.
Graph strategies use the existing explicit nodes/dependencies/input mappings and
package-local role IDs. Markdown template paths stay inside the package. No
package may choose another installation's agents or load a remote strategy.

For workspace work, set `execution.workspace` to `required`. A completion check
can require host-observed application evidence:

```json
{
  "checks": [{
    "capability": "workspace.artifact",
    "options": {"requireFresh": true, "requireInteraction": true}
  }]
}
```

Both options are explicit booleans. This check requires a workspace and uses the
desk's existing artifact adapter. It does not grant tools or execute a script.
The selected workspace, model/tool bindings and owner policy remain desk
choices. Unknown capabilities, missing resources and conflicting legacy
verification requests fail validation. Folders without `workflows` keep their
existing selected-lead behavior and storage representation.

The [`public/packages/starter`](../../public/packages/starter) folder is a complete
portable example with conversation, parallel-review graph and application
workflows, including their strategy and prompt files. Importing a copy creates
a distinct installed identity; its model aliases and tool requests still need
desk bindings. The [`examples/pond-team`](../../examples/pond-team) folder remains
a minimal no-manifest example. See [the full contract](UNIFIED-AGENT-PACKAGES.md#package-workflow-contract)
for schema bounds and compatibility rules.

## Current limits

The importer accepts at most 256 source files, 8 MiB per file, 32 MiB per folder,
and 64 roles. The desk keeps at most 32 installations with 128 MiB of original
source bytes in total; browser storage quotas can be lower. A failed durable
write does not activate the installation. Each successful import receives a new
installation identity, including when display names match an existing package.

Reload validates saved bytes again and restores the selected workflow. It does
not replay tasks. Unavailable model bindings or invalid saved definitions appear
disabled rather than substituting a bundled agent. Files stay in this browser
profile and origin; browser data clearing can remove them.

Bundled definitions now use `bundled/<desk-id>/<role-id>`; owner installations use
`installed/<installation-id>/<role-id>`. Old bundled session/history keys are
preserved for review and are not silently copied into the new identities.

In-browser source editing, replacement/upgrades, removal and backup export
remain pending. The credential-isolating broker is also pending: package files
cannot contain credentials, but existing workers still receive configured
transport data. Application tools remain trusted desk capabilities. A package
cannot create a new search, browser-control, or media adapter simply by naming one.
