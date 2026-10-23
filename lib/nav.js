import { BugIcon, FolderGit2Icon, FolderIcon, HomeIcon, RadioIcon, ShapesIcon } from "lucide-react"
import { ROUTES } from "@/lib/config"

// Single source of truth for app navigation: the sidebar and header
// breadcrumb both read from here. Add a component = add an entry + its page.
export const homeItem = { title: "Home", url: ROUTES.home, icon: HomeIcon }

export const componentItems = [
  {
    title: "Live follow",
    url: ROUTES.live,
    icon: RadioIcon,
    description: "Every tool call as it happens and the state it left (the artifact it changed, drawn by its view), the preview, the artifacts and the desk's background log.",
  },
  {
    title: "Debug",
    url: ROUTES.agents,
    icon: BugIcon,
    description: "One agent turn by turn: each step's model call, calls and results, its role, tools, artifacts and next prompt.",
  },
  {
    title: "Canvas",
    url: ROUTES.canvas,
    icon: ShapesIcon,
    description: "The desk on a canvas you pan and zoom: every agent from its tree, up close its run as it happens.",
  },
  {
    title: "Projects",
    url: ROUTES.projects,
    icon: FolderGit2Icon,
    description: "Load a project of yours from anywhere on this computer: the desk sets it up and works on it.",
  },
  {
    title: "Files",
    url: ROUTES.files,
    icon: FolderIcon,
    description: "Browse the desk's workspace.",
  },
]

export function findNavItem(pathname) {
  return [homeItem, ...componentItems].find((item) => item.url === pathname)
}

// One agent's debug page (the agent's twin turn by turn: its runs' steps, definition, tools, artifacts, next prompt).
export const agentHref = (name) => `${ROUTES.agents}?name=${encodeURIComponent(name)}`

// The workflow viewer on one staged workflow (an artifact with view pipeline), optionally on one of its stages.
// A workflow lives on the dashboard (2026-10-22 owner: "I want the workflow UI in the dashboard page itself"): its card
// opened big. `/workflow?id=` (an old link) lands here too.
export const workflowHref = (id) => `${ROUTES.home}?open=${encodeURIComponent(id)}`
