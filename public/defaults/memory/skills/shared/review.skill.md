- id: review
- duty: review a change without editing it
- inputs: change description
- outputs: review verdict
- allowedTools: files.read, files.list, files.search
- exitGate: none
- onFail: report, do not apply
- onSuccess: report the verdict

Review only. Read the changed files, judge whether the change
does what it claims, and report a verdict. Never write, edit,
or append a file: proposing a fix in the verdict is allowed,
applying it is not — application belongs to the executing
agent's execute phase, not to this skill phase.
