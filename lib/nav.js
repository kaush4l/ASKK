import { AudioLinesIcon, BotIcon, FolderIcon, HomeIcon, RadioIcon, ShapesIcon } from "lucide-react"
import { ROUTES } from "@/lib/config"

// Single source of truth for app navigation: the sidebar and header
// breadcrumb both read from here. Add a component = add an entry + its page.
export const homeItem = { title: "Home", url: ROUTES.home, icon: HomeIcon }

export const componentItems = [
  {
    title: "Agents",
    url: ROUTES.agents,
    icon: BotIcon,
    description: "Each agent of the desk: its role, tools, artifacts and runs; talk to it.",
  },
  {
    title: "Live follow",
    url: ROUTES.live,
    icon: RadioIcon,
    description: "Every tool call as it happens, the artifacts and the desk's background log.",
  },
  {
    title: "Canvas",
    url: ROUTES.canvas,
    icon: ShapesIcon,
    description: "The desk on a canvas you pan and zoom: every agent from its tree, up close its run as it happens.",
  },
  {
    title: "Files",
    url: ROUTES.files,
    icon: FolderIcon,
    description: "Browse the desk's workspace.",
  },
  {
    title: "Speech to speech",
    url: ROUTES.sts,
    icon: AudioLinesIcon,
    description: "Talk to the lead and hear it work: on-device speech in, every status and the answer spoken back.",
  },
]

export function findNavItem(pathname) {
  return [homeItem, ...componentItems].find((item) => item.url === pathname)
}

// One agent's page (the agent's twin: definition, tools, artifacts, runs).
export const agentHref = (name) => `${ROUTES.agents}?name=${encodeURIComponent(name)}`
