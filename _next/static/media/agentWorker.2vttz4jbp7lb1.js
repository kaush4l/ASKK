/**
 * A sub-agent, running on its own named thread.
 *
 * One of these per agent that is called as a tool. The worker is created with
 * `{ name: <agent name> }`, so the agent's own identity is the thread's
 * identity — visible in devtools, and the reason two agents doing long work at
 * once are two threads rather than two turns.
 *
 * A sub-agent is given no sub-agent tools of its own. That is a depth limit,
 * not an oversight: agents that can call each other freely can call each other
 * in a cycle, and a cycle of threads that each spawn threads is a fork bomb on
 * the user's machine. One level down is enough to be useful and cannot recur.
 */
import { AgentCatalogue } from '../core/agent/AgentCatalogue.js'
import { describeEnvironment } from '../core/agent/Environment.js'
import { buildAgent } from '../core/agent/loadAgent.js'
import { createInference } from '../core/inference/index.js'
import { Outcome, Reason } from '../core/Outcome.js'

const catalogue = new AgentCatalogue(process.env.NEXT_PUBLIC_BASE_PATH ?? '')

self.addEventListener('message', async (event) => {
  const { id, name, task, settings } = event.data ?? {}

  const spec = await catalogue.spec(name)
  if (!spec.ok) {
    self.postMessage({ id, ...Outcome.failed(Reason.NOT_FOUND, spec.failure.message).toJSON() })
    return
  }

  const inference = createInference({
    kind: settings.kind,
    model: spec.value.model || settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    temperature: spec.value.temperature ?? settings.temperature,
    maxTokens: spec.value.maxTokens,
  })

  const agent = buildAgent({
    spec: spec.value,
    inference: inference.value,
    tools: [],
    // A sub-agent gets the same facts as its caller.
    context: describeEnvironment(),
  })
  if (!agent.ok) {
    self.postMessage({ id, ...agent.toJSON() })
    return
  }

  // A sub-agent has no memory of its own: it is asked one complete question and
  // answers it. Keeping a transcript per sub-agent would make the same call
  // return different things at different times, which is not what a tool is.
  const answered = await agent.value.run([{ role: 'user', text: task }])
  const reply = answered.ok
    ? Outcome.ok(
        typeof answered.value === 'string' ? answered.value : answered.value.answer,
        answered.notes,
      )
    : answered
  self.postMessage({ id, ...reply.toJSON() })
})

self.postMessage({ type: 'ready', name: self.name })
