// The live page's artifact tabs: one per live artifact the engines publish
// (state.live[type]), rendered by the panel registered for its type, else by
// its view, else the generic panel. filesystem + shared share the Files tab.

import { ChecklistView } from "@/components/live/panels/checklist-panel"
import { CompactView } from "@/components/live/panels/compact-panel"
import { GenericView } from "@/components/live/panels/generic-panel"
import { SkillsView } from "@/components/live/panels/skills-panel"
import { TeamView } from "@/components/live/panels/team-panel"

// type -> { label, render(snapshot) }. Files and terminal are drawn by the
// page itself (they need the feed and the terminal stream).
const PANELS = {
  checklist: { label: "Checklist", Panel: ChecklistView },
  skills: { label: "Skills", Panel: SkillsView },
  team: { label: "Sub-agents", Panel: TeamView },
  compact: { label: "Compaction", Panel: CompactView },
}

const BY_VIEW = { checklist: ChecklistView }
const FILES = new Set(["filesystem", "shared"])

// Tabs for the artifacts present: [{ id, label, type?, Panel? }].
export function artifactTabs(artifacts, { terminal = false } = {}) {
  const tabs = []
  const types = Object.keys(artifacts)
  if (types.some((t) => FILES.has(t))) tabs.push({ id: "files", label: "Files" })
  if (terminal || artifacts.terminal) tabs.push({ id: "terminal", label: "Terminal" })
  for (const type of types.sort()) {
    if (FILES.has(type) || type === "terminal") continue
    const known = PANELS[type]
    const snapshot = artifacts[type]
    tabs.push({
      id: `a:${type}`,
      type,
      label: known?.label ?? snapshot.title ?? type,
      Panel: known?.Panel ?? BY_VIEW[snapshot.view] ?? GenericView,
    })
  }
  return tabs
}
