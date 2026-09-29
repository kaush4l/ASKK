# Outstanding command context

The configured workspace context asks the desk for `run.pendingCommands` before each model request when the current run declares `workspace.commands`. Each result retains its original zero-based `requiredCheck` index and a bounded diagnostic. Inherited overall workflow requirements never grant command references to a child run.

The desk reuses the installed completion adapter for each exact command. This preserves task ownership, binding, source freshness, cancellation, and actual exit checks. The inspection cannot run commands, publish verification, or persist a completion receipt. These sequential observations may become stale; an empty list does not prove completion. The existing aggregate completion gate still runs independently.

The implementation performs up to 16 adapter inspections per prompt. Each may read a source snapshot. This favors predicate reuse over a second competing success definition; batch optimization and latency measurement remain future work.

Validation: 1,038 passing tests, one skipped, zero failed, 7,842 assertions across 102 files. Tests include real evaluation-validator ownership, newer failures, source invalidation, write-and-revert, runtime replacement, cancellation, frozen references, and absence of verification publication. Production static export passed. No new live-model, Safari, iPhone, VoiceOver, or Browser Linux acceptance run was performed. This change does not prove improved model reliability or enforce a read → failing test → repair → passing test sequence.
