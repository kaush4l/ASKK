# Folder agent examples

These files are outside `public/` and are not advertised to production workbench agents.
`main/` demonstrates both local arithmetic tools and an owned `haiku/` agent. It retains
the supported version 1 response format. Production coding agents use version 2.

The legacy runtime test explicitly copies this example into its temporary published site
before applying its own test configuration. To try the example manually, use a separate
copy of the harness and replace that copy's `public/agents/main/` with this `main/` folder.
Regenerate its published agent listing before running it.

The optional `create_agent` demonstration requires a companion rooted at the harness
repository itself. It writes agent configuration into `public/agents/main/`; a companion
rooted at an application workspace is unsuitable. This authoring demonstration is not
part of the production workbench's workspace capabilities.
