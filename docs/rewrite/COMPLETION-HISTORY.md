# Completion feedback history

Agent folders and imported packages can opt into `rejected_completion_history: omit` in `agent.md`. The default is `retain`. Unknown values are rejected during loading and engine construction.

`omit` defers adding a proposed final answer to conversational history until the configured completion verifier accepts it. Rejected proposals remain outside future prompts and compaction input; the verification failure and its corrective observation remain in history. Tool calls and their paired results are unaffected. The engine does not choose the next action or change completion requirements.

The worker sends the exact candidate content and attempt ID to the desk. Completed verification receipts retain this proposal, visible through the inspector's exact verification receipt and trace export. A separate immutable `completionProposals` audit collection records proposals before verification, including attempts interrupted by cancellation. It is preserved in stored runs and exports independently of bounded UI logs and model history. A proposal is not a verification receipt and cannot establish success.

No bundled agent enables omission yet. A prior live 4B diagnostic repeatedly carried rejected completion claims forward, but that observation does not establish causality. The option enables a controlled comparison; improved live-model reliability remains unproven.

Validation covers native and envelope protocols, default compatibility, configured omission, actual worker configuration, next-prompt contents, compaction, exact long proposal persistence/export, and cancellation during verification. No completion checks were weakened.

## Live comparison

The opt-in project evaluator accepts `--rejected-completion-history retain|omit` (API: `rejectedCompletionHistory`). It overrides only the copied agent configuration for that attempt and records the effective setting plus completion proposals in evidence. Invalid values fail before creating an attempt. Keep the task, model profile, command limits, completion contract, and independent checks identical when comparing modes; never infer correctness from fewer rejected answers or more tool calls.
