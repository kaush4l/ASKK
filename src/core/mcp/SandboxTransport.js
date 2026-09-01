import { Outcome, Reason } from '../Outcome.js'

/**
 * MCP over stdio — with the process living in the sandbox.
 *
 * This is the transport that makes MCP work in a browser at all. An MCP server
 * is normally a process reading JSON-RPC from stdin; a page has no processes, so
 * the usual conclusion is that MCP cannot run here. It can: the sandbox is a
 * Linux userland, and a command run there is a process.
 *
 * The mechanism is a shell pipeline, because that is what the sandbox offers:
 *
 *     printf '%s\n' '<request>' | <server command>
 *
 * The server reads one line of JSON-RPC on stdin, writes its reply on stdout,
 * and exits when stdin closes. Every server that speaks stdio does this — it is
 * the contract, not a trick.
 *
 * THE LIMITATION, stated rather than hidden: one request per process. The
 * sandbox boots a fresh guest per command, so a server holding state between
 * calls will not keep it, and `initialize` is re-sent with every request. For a
 * server that reads a file or runs a query this is exactly right. For one that
 * opens a connection and expects to keep it, it is not, and this transport is
 * the wrong choice rather than a broken one.
 */
export class SandboxTransport {
  /**
   * @param {{sandbox: object, command: string, args?: string[],
   *   env?: object, cwd?: string, timeout?: number}} options
   *   `command` and `args` are the server's command line inside the guest, in
   *   the same shape a standard MCP configuration writes them.
   */
  constructor({ sandbox, command, args = [], env = {}, cwd = '', timeout = 120_000 }) {
    this.sandbox = sandbox
    this.command = SandboxTransport.commandLine({ command, args, env, cwd })
    this.timeout = timeout
    // Everything the server must be told before the request it is being sent.
    // Re-sent every time because every time is a new process.
    this._preamble = []
  }

  /** Requests replayed ahead of each call, in order. `initialize` belongs here. */
  remember(request) {
    this._preamble.push(request)
  }

  async send(request) {
    if (!this.sandbox?.available) {
      return Outcome.failed(Reason.UNAVAILABLE, 'the sandbox is not available', {
        hint: 'An MCP server that runs as a command needs the sandbox. Configure a sandbox image, or use an HTTP server instead.',
      })
    }

    // Every process is new, so anything the server was told before has to be
    // told again — otherwise the second request arrives before initialize.
    const lines = [...this._preamble, request]
    if (request.method === 'initialize') this.remember(request)

    // Single-quoted with the shell's own escape for an embedded quote. JSON is
    // full of double quotes and backslashes and none of them mean anything
    // inside single quotes, which is what makes this safe rather than lucky.
    const payload = lines
      .map((line) => JSON.stringify(line).replaceAll("'", `'\\''`))
      .map((line) => `'${line}'`)
      .join(' ')

    const ran = await this.sandbox.run(`printf '%s\\n' ${payload} | ${this.command}`, {
      timeout: this.timeout,
    })
    if (!ran.ok) return ran

    const found = SandboxTransport.replyTo(ran.value.stdout, request.id)
    if (!found) {
      return Outcome.failed(
        Reason.UNAVAILABLE,
        `the server wrote no reply to request ${request.id} (exit ${ran.value.code})`,
        {
          hint: ran.value.stdout.trim().slice(0, 300) || 'It produced no output at all.',
        },
      )
    }
    return Outcome.ok(found, ran.notes)
  }

  /**
   * A message with no id, and so no reply to wait for.
   *
   * `notifications/initialized` is the one that matters, and it is remembered
   * rather than sent: the process that would receive it is about to exit, and
   * the next one has to be told the same thing before it is asked anything.
   */
  async notify(message) {
    this.remember(message)
    return Outcome.ok(null)
  }

  /**
   * A configuration's command, args, env and cwd as one shell line.
   *
   * Every piece is quoted, because a server's arguments come from a config file
   * somebody pasted and a path with a space in it must not become two
   * arguments. Env goes in front as `NAME=value` assignments, which is how a
   * POSIX shell scopes a variable to one command and needs no `export`.
   */
  static commandLine({ command, args = [], env = {}, cwd = '' }) {
    const quote = (text) => `'${String(text).replaceAll("'", `'\\''`)}'`
    const assignments = Object.entries(env).map(([name, value]) => `${name}=${quote(value)}`)
    const line = [...assignments, command, ...args.map(quote)].filter(Boolean).join(' ')
    return cwd ? `cd ${quote(cwd)} && ${line}` : line
  }

  /**
   * The reply to one request, out of everything the process printed.
   *
   * Matched on id. A server may log to stdout, and it will certainly answer the
   * replayed preamble first — taking the last line or the first would read
   * somebody else's answer.
   */
  static replyTo(stdout, id) {
    for (const line of String(stdout).split('\n')) {
      const text = line.trim()
      if (!text.startsWith('{')) continue
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        continue
      }
      if (parsed?.id === id) return parsed
    }
    return null
  }
}
