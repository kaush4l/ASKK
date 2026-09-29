# Import a folder-defined agent

The dashboard's **Import agent** button loads a declarative folder into the
current browser. The definition, model mapping, selected lead, and approved tool
groups are saved in IndexedDB before activation. Installation does not run an
agent task. Imported JavaScript and other executable source are rejected.

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
5. Select **Install agent**. The installed lead becomes the selected workflow.
   Enter a goal and start it. Inspect its recorded prompts and actual tool results.

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

Imported private memory and prior-session lookup are scoped to the installation
and role. Imported `shared` memory is limited to the current package task, so it
does not expose the desk's global shared notes. Scheduled work is not supported
for imports yet because deferred tasks cannot retain all required bindings.

Local `soul.md` and `learned.md` accompany the role whose folder contains them.
`prompt_template` and explicit `skills` paths are relative to that role's folder.
Shared parent instructions are not inherited implicitly. Authored source remains
unchanged and SHA-256 checked. Credentials and transport settings belong in the
desk, never in a package.

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

This release adds installation and execution. In-browser source editing,
replacement/upgrades, removal, backup export, explicit package-defined execution
bindings, and migration of the bundled catalogue are still pending. Bundled
application tools remain trusted desk capabilities. A package cannot create a
new search, browser-control, or media adapter simply by naming one.
