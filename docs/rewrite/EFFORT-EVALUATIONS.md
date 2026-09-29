# Evaluating configured effort

`evaluateProjectLoop({ maxSteps })` and the CLI `--max-steps` override only the copied agent definition for that evaluation. Omitting the option preserves the packaged definition, currently 24 steps for the builder. Supplied values use the shared safe-integer bounds of 1–1000 and fail before creating output if invalid. The recorded `maxSteps` is the effective compiled setting.

The limit applies to ordinary agent steps. A final budget-summary request may add one prompt, without permitting additional tool dispatch or turning an incomplete run into success. Increasing this allowance does not increase the context window or wall-clock deadline, and does not change completion checks. Budget context and warnings change, so a larger budget is not a continuation with an identical prompt prefix.

The 4B diagnostic in `evidence/effort48-model.json` exhausted 48 steps with 28 rejected completion claims. It delivered source but no tests; independent test discovery failed. The preceding 24-step diagnostic delivered passing files but did not finish its own required verification. Neither run passed overall. This evidence does not justify raising the production default.

Current UI limitations: the definition inspector exposes the configured step limit and stopped runs distinguish step-budget exhaustion. The live dashboard does not yet display a steps-used counter or provide a direct effort selector. Stop controls remain available.
