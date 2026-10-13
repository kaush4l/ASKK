// Time stamps and log lines for the host's scripts and runners.

export const stamp = () => new Date().toISOString()

// "<ISO time> <line>" on stdout (cron logs).
export const logLine = (line) => console.log(`${stamp()} ${line}`)
