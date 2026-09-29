/** Run status qualifies model text; only recorded evidence describes checks. */
export default function AnswerOutcome({ status, terminationReason, completionEvidence }) {
  const problem = ['incomplete', 'failed', 'error', 'cancelled', 'stopped', 'interrupted', 'unresponsive'].includes(status)
  const label = status === 'incomplete' && terminationReason === 'step_budget'
    ? 'Incomplete · Unverified step-limit summary. The task did not complete; the model’s claims below are not verified.'
    : status === 'incomplete' ? 'Incomplete · The task did not complete. The model’s answer below does not establish success.'
      : ['failed', 'error'].includes(status) ? 'Failed · The run failed. The model’s answer below does not establish success.'
        : ['cancelled', 'stopped'].includes(status) ? 'Stopped · The run was cancelled. The model’s answer below does not establish success.'
          : status === 'interrupted' ? 'Interrupted · The run was interrupted. The model’s answer below does not establish success.'
            : status === 'unresponsive' ? 'Response delayed · The run’s outcome is unresolved. The model’s answer below does not establish success.'
              : 'Recorded model answer · The model’s answer does not establish that the task passed its checks.'
  return <>
    <p className={`dashboard-answer-status${problem ? ' is-problem' : ''}`}>{label}</p>
    {typeof completionEvidence?.label === 'string' && completionEvidence.label && <p className={`dashboard-answer-evidence${completionEvidence.outcome === 'failed' ? ' is-failed' : ''}`}>{completionEvidence.label}</p>}
  </>
}
