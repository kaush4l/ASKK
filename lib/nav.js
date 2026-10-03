import { BotIcon, FolderIcon, HomeIcon, MessageSquareIcon, SettingsIcon } from "lucide-react"

// Single source of truth for app navigation: the sidebar and header
// breadcrumb both read from here. Add a component = add an entry + its page.
export const homeItem = { title: "Home", url: "/", icon: HomeIcon }

export const settingsItem = { title: "Settings", url: "/settings", icon: SettingsIcon }

export const componentItems = [
  {
    title: "Chat",
    url: "/chat",
    icon: MessageSquareIcon,
    description: "Conversational interface.",
  },
  {
    title: "Agents",
    url: "/agents",
    icon: BotIcon,
    description: "View and edit agent definitions.",
  },
  {
    title: "Files",
    url: "/files",
    icon: FolderIcon,
    description: "Browse the folder ASKK runs from.",
  },
]

export function findNavItem(pathname) {
  return [homeItem, ...componentItems, settingsItem].find((item) => item.url === pathname)
}
