"use client"

import { hasWorkbench } from "@/backend/live/workbench"
import { GuideBox } from "@/components/live/guide-box"
import { FeedList, LiveHeader, LiveTabs, useLiveFollow } from "@/components/live/live-side"
import { Workbench } from "@/components/live/workbench/workbench"

// Everything the desk does as it happens, beside the agents' threads rather than in them. Left: every tool call
// and every refused answer, newest first. Right: the followed call drawn by its tool's view; every artifact drawn
// by its view; the desk's background log (watchers, schedule, wakes, Telegram); the wake book. Below: a message
// to the agent that made the call. `?tab=desk` opens a tab.
// 2026-10-17: a desk whose agents hold the inbuilt files / terminal / preview artifacts gets the workbench instead
// (components/live/workbench/: Files, tabs over the open file or page, Terminal; this page's parts in a side slot).
export function LivePage() {
  const live = useLiveFollow()
  if (hasWorkbench(live.desk?.artifacts)) return <Workbench live={live} />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      <LiveHeader live={live} />
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <FeedList live={live} className="max-h-56 rounded-lg border md:max-h-none" />
        <div className="flex min-h-[60svh] min-w-0 flex-col gap-3 md:min-h-0">
          <LiveTabs live={live} artifacts={live.desk?.artifacts ?? {}} />
          <GuideBox engine={live.guideEngine} state={live.guideState} />
        </div>
      </div>
    </div>
  )
}
