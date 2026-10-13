import { AudioLinesIcon, BotIcon, FolderIcon, HomeIcon, MessageSquareIcon, RadioIcon, SettingsIcon } from "lucide-react"
import { ROUTES } from "@/lib/config"

// Single source of truth for app navigation: the sidebar and header
// breadcrumb both read from here. Add a component = add an entry + its page.
export const homeItem = { title: "Home", url: ROUTES.home, icon: HomeIcon }

export const settingsItem = { title: "Settings", url: ROUTES.settings, icon: SettingsIcon }

export const componentItems = [
  {
    title: "Chat",
    url: ROUTES.chat,
    icon: MessageSquareIcon,
    description: "Conversational interface.",
  },
  {
    title: "Speech to speech",
    url: ROUTES.sts,
    icon: AudioLinesIcon,
    description: "Talk to the lead and hear it work: on-device speech in, every status and the answer spoken back.",
  },
  {
    title: "Agents",
    url: ROUTES.agents,
    icon: BotIcon,
    description: "View and edit agent definitions.",
  },
  {
    title: "Live follow",
    url: ROUTES.live,
    icon: RadioIcon,
    description: "Every tool call as it happens: terminal, file changes, quests.",
  },
  {
    title: "Files",
    url: ROUTES.files,
    icon: FolderIcon,
    description: "Browse the folder ASKK runs from.",
  },
]

export function findNavItem(pathname) {
  return [homeItem, ...componentItems, settingsItem].find((item) => item.url === pathname)
}
