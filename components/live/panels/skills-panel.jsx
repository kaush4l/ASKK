import { snapshotLabel } from "@/components/live/format"

// live.skills (SkillsArtifact.live()): the skills this agent has loaded now.
export function SkillsView({ snapshot }) {
  const items = snapshot?.data?.items ?? []
  return (
    <div className="flex flex-col gap-2 overflow-auto text-xs">
      <p className="text-[11px] text-muted-foreground">{snapshotLabel(snapshot)}</p>
      {!items.length && <p className="text-muted-foreground">No skills loaded. The agent loads one with skills.load before work it describes.</p>}
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item.name} className="rounded-md border px-2 py-1 text-foreground">
            {item.name}
          </span>
        ))}
      </div>
    </div>
  )
}
