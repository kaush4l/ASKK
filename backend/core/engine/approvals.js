// Approvals: a tool call waits for the owner (state.approvals) until answered.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.



export class ApprovalsPart {
  // ── approval ───────────────────────────────────────────────────────────

  // Wait for the owner to approve or decline one exact call (state
  // `approvals`, answered with resolveApproval). Aborting declines it.
  _requestApproval(tool, inputs, signal) {
    if (signal?.aborted) return Promise.resolve(false)
    const id = `approval-${++this._approvalCount}`
    // The activity to go back to is the one before the FIRST open approval
    // (with overlapping approvals, a later one would restore "approval").
    if (!this._state.approvals.length) this._activityBeforeApproval = this._state.activity
    this.update({
      approvals: [
        ...this._state.approvals,
        { id, tool: tool.name, inputs, summary: tool.describe?.(inputs) ?? null, at: new Date().toISOString() },
      ],
      activity: { phase: "approval", name: tool.name },
    })
    return new Promise((resolve) => {
      const done = (ok) => {
        if (!this._approvalWaits.has(id)) return
        this._approvalWaits.delete(id)
        signal?.removeEventListener("abort", onAbort)
        const approvals = this._state.approvals.filter((a) => a.id !== id)
        this.update({ approvals, ...(approvals.length ? {} : { activity: this._activityBeforeApproval }) })
        resolve(ok)
      }
      const onAbort = () => done(false)
      this._approvalWaits.set(id, done)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  resolveApproval(id, ok) {
    this._approvalWaits.get(id)?.(!!ok)
  }

}
