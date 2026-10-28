// The tap target (2026-10-26 tap-helper-home, tap-helper-adopt): a control a finger can hit is 40px tall and wide.
// TAP_MIN holds at every width; PHONE_TAP holds below sm only, so a control stays dense from sm up. PHONE_TAP is
// TAP_MIN with max-sm: on each class, written out whole (not built) so Tailwind's scanner sees each class.
export const TAP_MIN = "min-h-10 min-w-10"

export const PHONE_TAP = "max-sm:min-h-10 max-sm:min-w-10"
