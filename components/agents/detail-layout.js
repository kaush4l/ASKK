// 2026-10-27 ask-point: the layout of one agent's page (AgentDetail in components/agents/agent-page.jsx). Below md the
// header (description, stats, meters, report rows) fills most of a phone's height, so a pane that only shrinks under it
// left the Artifacts list a sliver: talk's "Ask about this" could not be reached. On phones the whole detail scrolls and
// the Artifacts pane takes its content's height; from md up the header stays and the pane scrolls inside itself.
export function detailLayout() {
  return {
    root: "flex min-h-0 min-w-0 flex-1 flex-col max-md:overflow-y-auto",
    artifacts: "flex min-h-0 flex-1 flex-col p-4 max-md:flex-none",
  }
}
