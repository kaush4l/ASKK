"use client"

import Link from "next/link"

// The stage's twin in a card (kernel builtin/stage.js; the whole of it is the /stage page): the page on stage, the
// scene the owner is taken to with what it shows, the questions still open. Closed: the scene's title only.
export function StageView({ state, expanded }) {
  const scenes = state?.scenes ?? []
  const scene = scenes.find((s) => s.id === state?.current) ?? scenes[0] ?? null
  const open = (state?.asks ?? []).filter((a) => !a.answer).length
  if (!state?.page && !scenes.length) return <p className="mt-1 text-xs text-muted-foreground">Nothing on stage yet.</p>
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs">
      {scene && (
        <p className="break-words">
          <span className="text-muted-foreground">
            ▶ {scenes.indexOf(scene) + 1}/{scenes.length}
          </span>{" "}
          <span className="text-foreground">{scene.title}</span>
        </p>
      )}
      {expanded && scene?.says && <p className="line-clamp-4 break-words text-muted-foreground">{scene.says}</p>}
      {expanded && open > 0 && (
        <p className="text-amber-400">
          {open} question{open === 1 ? "" : "s"} open
        </p>
      )}
      <Link href="/stage" className="w-fit text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline pointer-coarse:py-2.5">
        Open the stage{state?.page?.title ? `: ${state.page.title}` : ""}
      </Link>
    </div>
  )
}
