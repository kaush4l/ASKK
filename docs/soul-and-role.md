# Soul and role

Every agent's prompt starts with two sections that do different jobs.

| | Soul (opens the prompt, no header) | Role (`# YOU ARE <name>`, right after the soul) |
|---|---|---|
| What it is | The agent's identity: character and values | The hat it wears for this work |
| Changes | Almost never. One soul is shared by every agent | Per agent: developer, architect, tester, debugger, writer… |
| Contains | How it treats truth, the owner, scope, risk, and other people's words | What the work looks like, its rules, the tools and artifacts it uses, what has been learned about doing it well |
| Never contains | A job, a domain, tools, procedures, expertise claims | Values that should hold in every role |
| File | the desk's soul (e.g. `custom/<desk>/agents/soul.md`, a team's own `soul.md`) | the `agent.md` body |

A person works the same way. The same person can be a developer in the
morning, an architect after lunch and a poet at night. Their character, which
is how honest they are, what they care about and how they treat people, is
the same in every one. What changes is the hat: what they know to do, the
rules of that craft, and the lessons learned in it. The soul is never the
working hat.

## What the research says

- **A generic identity alone does not make an agent better at tasks.**
  Zheng et al. tested 162 roles in system prompts across 4 model families and
  2,410 factual questions. Adding a persona did not improve accuracy
  consistently over no persona, and which persona helps was close to random
  ([EMNLP Findings 2024](https://aclanthology.org/2024.findings-emnlp.888/)).
  So the soul is not there to raise scores. It is there for consistency and
  values.
- **A role matched to the task does help.** Role-play prompting (a task-matched
  role set up before the question) beat standard zero-shot on most of 12
  reasoning benchmarks, for example AQuA 53.5% → 63.8% on ChatGPT. It acted as
  a stronger trigger for step-by-step reasoning than "think step by step"
  ([Kong et al., NAACL 2024](https://arxiv.org/abs/2308.07702)).
  ExpertPrompting writes a detailed expert identity *for each instruction*
  and gets clearly better answers
  ([Xu et al., 2023](https://arxiv.org/abs/2305.14688)). Zheng et al. also
  found that accuracy rises with the similarity between the role and the
  question. The gain comes from the **role being specific to the work**:
  that is the agent instructions' job.
- **A wrong or loose persona can hurt.** Role-play prompts lowered GPT-4's
  reasoning on 4 of 12 datasets
  ([Kim et al., "Persona is a Double-edged Sword"](https://aclanthology.org/2025.findings-ijcnlp.51/)).
  Personas tied to a social identity bring out the model's biases
  ([Salewski et al., NeurIPS 2023](https://arxiv.org/abs/2305.14930)). So the
  soul names no demographics and claims no expertise, and a role must fit the
  task it is used for.
- **Character is real and steerable.** Anthropic trains Claude's character
  (curiosity, open-mindedness, honesty) as part of alignment
  ([Claude's character](https://www.anthropic.com/research/claude-character)),
  and finds traits such as sycophancy and hallucination as directions inside
  the model that can be monitored and steered
  ([Persona vectors, 2025](https://arxiv.org/abs/2507.21509)). A stable
  description of values (honest, not sycophantic, not inventing results) aims
  at exactly those traits. That is what the soul is for.

**In short:** the soul keeps the agent the same trustworthy self in every
role, and the role makes it good at this particular work.

## Writing a soul

- Write who the agent *is*, in values and character: how it treats truth,
  the owner's goal and scope, risk, and words written by others.
- Phrase it as identity ("You are honest…"), not procedure ("Call fs.open…").
- Leave out jobs, domains, tools, artifacts and formats. If a line would be
  wrong for some role, it belongs in that role instead.
- Leave out demographics and claims of expertise.
- Keep it short: it is sent with every request of every agent.

## Writing a role (agent.md body)

Start with one sentence that puts on the hat, specific to the work:

```markdown
You are working as <the role, matched to the work>: <what this agent is for>.

### The work
What requests look like, and where the work happens (artifacts, tools, other agents).

### Rules
The rules of this craft: what to do first, what to prefer, what never to do, when it is done.

### Learned
Directions learned from earlier work in this role (optional; grows over time).
```

- **Specific beats grand.** "You are working as the developer of this
  project, changing its files yourself" is better than "You are a world-class
  engineer".
- **One agent, one hat.** If an agent needs two different hats (build, then
  review), make two agents and let one call the other.
- **Rules that hold in every role go in the soul**, not repeated in each
  role.
- **Shared know-how lives with the desk.** A procedure useful to several roles
  belongs in the desk (a tool, an artifact, a file its agents read), not pasted into every role.

## In the prompt

`backend/kernel/agent/agent.js` `render()` writes the prompt in the owner's reading order (2026-10-17 owner: "soul,
agent instructions, context, quest, history, tools and response format"):

1. the soul, with no header — the prompt opens on the identity itself;
2. `# YOU ARE <name>` with the role (the agent.md body);
3. context: every artifact the agent holds, `# <id> — <title>` each;
4. the quest: `# REQUEST (from …)`, then `# OWNER GUIDANCE` right under it while a note waits;
5. history: `# EARLIER RUNS`, then `# WORK DONE ON THIS REQUEST`;
6. `# TOOLS`;
7. `# RESPONSE` (the response and report formats), or `# SYSTEM` when a desk replaces it.

So the soul and the role are read before anything the agent holds or is asked, and how to reply is read last,
right before the agent writes. The full table is in `backend/kernel/README.md` (d).
