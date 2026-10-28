import { useMediaQuery } from "@/hooks/use-media-query"
import { LIMITS } from "@/lib/config"

export const useIsMobile = () => useMediaQuery(`(max-width: ${LIMITS.ui.mobileBreakpointPx - 1}px)`)
