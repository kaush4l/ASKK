import { useMediaQuery } from "@/hooks/use-media-query";

// Retelling note: main's use-mobile read the breakpoint from lib/config.
// Here it is local, so the skeleton does not inherit the old app's limits.
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
