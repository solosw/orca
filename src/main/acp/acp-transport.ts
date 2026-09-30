import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnProcess } from '../../shared/child-process/run-process'
import { quoteWindowsCmdArgument } from '../../shared/child-process/windows-command-line'
import type { AcpAgentLaunch } from '../../shared/acp-types'
import { getSshConnectionManager } from '../ipc/ssh'
import { shellEscape } from '../ssh/ssh-connection-utils'

/** Bytes of agent stderr retained for diagnostics (bounded; a runaway logger must not grow the main process). */
export const ACP_STDERR_TAIL_BYTES = 8 * 1024

/**
 * How long `close()` waits for the agent to exit after stdin is ended.
 *
 * Why a bound: an agent that ignores EOF would otherwise pin the caller — and
 * `close()` runs inside the quit barrier, so an unbounded wait here would hang
 * the whole quit on one uncooperative remote process.
 */
export const ACP_CLOSE_GRACE_MS = 2_000

/**
 * A live ACP agent process plus the byte streams carrying JSON-RPC frames.
 *
 * Why raw byte streams rather than parsed messages: the ACP SDK owns framing
 * (`ndJsonStream`), so this layer stays a pure pipe and never re-implements
 * line buffering or JSON parsing.
 */
export type AcpTransport = {
  /** Bytes the client writes (the agent's stdin). */
  writable: WritableStream<Uint8Array>
  /** Bytes the client reads (the agent's stdout). */
  readable: ReadableStream<Uint8Array>
  /**
   * Resolves when the agent exits. `signal` is a plain string rather than
   * `NodeJS.Signals`: a local child reports a Node signal name, while an SSH
   * channel reports whatever the remote sshd wrote, which is not a closed set.
   */
  closed: Promise<{ code: number | null; signal: string | null }>
  /** The retained stderr tail, for reporting a startup failure the protocol never saw. */
  stderrTail: () => string
  /** Terminates the agent. Idempotent. */
  close: () => Promise<void>
}

/**
 * Node's `Readable` → web `ReadableStream`.
 *
 * Why `Bytes` is copied: Node hands out a pooled Buffer whose backing memory is
 * reused after the listener returns, so enqueueing it directly would deliver
 * bytes the OS is free to overwrite.
 */
function toWebReadable(source: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on('data', (chunk: Buffer | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        controller.enqueue(new Uint8Array(bytes))
      })
      source.on('end', () => {
        try {
          controller.close()
        } catch {
          // Already closed by an error/close path.
        }
      })
      source.on('error', (error: Error) => {
        try {
          controller.error(error)
        } catch {
          // Already closed.
        }
      })
    }
  })
}

/** Web `WritableStream` → Node `Writable`. */
function toWebWritable(sink: NodeJS.WritableStream): WritableStream<Uint8Array> {
  // Why swallow stream errors here: Node re-emits a write failure (EPIPE,
  // ERR_STREAM_WRITE_AFTER_END) on the sink when the agent has already exited.
  // The write() promise below is what the ACP SDK observes; without this
  // listener the same failure is also an uncaught exception in the main process.
  sink.on('error', () => {})
  // Why narrowed here: both callers hand us a real Node stream (a child's stdin
  // or an SSH channel), but the `NodeJS.WritableStream` alias omits the
  // `writableEnded`/`destroyed` liveness flags this write path has to check.
  const writable = sink as NodeJS.WritableStream & {
    writableEnded?: boolean
    destroyed?: boolean
  }
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        // The agent may exit mid-write; a failed write must reject the RPC
        // rather than surface as an unhandled stream error.
        if (writable.writableEnded || writable.destroyed) {
          reject(new Error('ACP agent stdin is already closed'))
          return
        }
        const onError = (error: Error): void => {
          sink.off('error', onError)
          reject(error)
        }
        sink.once('error', onError)
        sink.write(Buffer.from(chunk), (error?: Error | null) => {
          sink.off('error', onError)
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
    close() {
      return new Promise<void>((resolve) => {
        sink.end(() => resolve())
      })
    }
  })
}

/**
 * Keeps a bounded, newline-tolerant tail of an agent's stderr.
 *
 * Why stderr is drained and kept: the agent writes diagnostics there, and a
 * full stderr pipe blocks the agent mid-turn. The tail is bounded so a runaway
 * logger cannot grow this process's memory, and it is the only place an
 * agent's own error text can surface when startup fails before any RPC.
 */
function createStderrTail(): { append: (chunk: Buffer) => void; read: () => string } {
  const chunks: Buffer[] = []
  let bytes = 0
  return {
    append(chunk) {
      if (bytes >= ACP_STDERR_TAIL_BYTES) {
        return
      }
      chunks.push(chunk)
      bytes += chunk.length
      while (bytes > ACP_STDERR_TAIL_BYTES && chunks.length > 1) {
        bytes -= chunks.shift()!.length
      }
    },
    read: () => Buffer.concat(chunks).toString('utf8').trim()
  }
}

/** Whether a promise settled inside the deadline, without throwing on rejection. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/**
 * The one local Windows command line that starts the agent inside its workspace.
 *
 * Why `cd /d` and not only `spawn({ cwd })`: a custom agent is often a `.cmd`
 * shim, and that path is re-spawned through `cmd.exe`. The workspace must be
 * the current directory of that shell before the agent command runs, matching
 * the remote `cd &&` launch. `/d` also switches drive letters.
 */
export function buildLocalWindowsAcpCommandLine(
  launch: AcpAgentLaunch,
  cwd: string | undefined
): string {
  const argv = [launch.command.trim(), ...(launch.args ?? [])]
    .map(quoteWindowsCmdArgument)
    .join(' ')
  return cwd ? `cd /d ${quoteWindowsCmdArgument(cwd)} && ${argv}` : argv
}

/**
 * argv for `cmd.exe` that runs {@link buildLocalWindowsAcpCommandLine}.
 *
 * Why `/s /c` and not one verbatim argument: CreateProcess passes a single
 * argument through as the whole command line, so `cd /d` never executes and
 * cmd reports "the filename, directory name, or volume label syntax is
 * incorrect" once per failed token. `/d` skips AutoRun, `/v:off` keeps `!`
 * literal, and `/s` strips exactly one outer quote pair.
 */
export function buildLocalWindowsAcpSpawnArgs(
  launch: AcpAgentLaunch,
  cwd: string | undefined
): string[] {
  return ['/d', '/v:off', '/s', '/c', buildLocalWindowsAcpCommandLine(launch, cwd)]
}

/**
 * Start an ACP agent on this machine and expose its stdio as a byte transport.
 *
 * Why `spawnProcess` and not `child_process`: it is Orca's single spawn
 * chokepoint (Windows console hiding, argument quoting, `.cmd` shim
 * resolution), and a ratchet test rejects any new direct import.
 */
function startLocalAcpTransport(
  launch: AcpAgentLaunch,
  options: { cwd?: string; env?: NodeJS.ProcessEnv }
): AcpTransport {
  const windowsWorkspace = process.platform === 'win32' && Boolean(options.cwd)
  const child: ChildProcessWithoutNullStreams = spawnProcess({
    program: windowsWorkspace ? (process.env.ComSpec ?? 'cmd.exe') : launch.command.trim(),
    args: windowsWorkspace
      ? buildLocalWindowsAcpSpawnArgs(launch, options.cwd)
      : launch.args
        ? [...launch.args]
        : [],
    ...(options.cwd && !windowsWorkspace ? { cwd: options.cwd } : {}),
    // `launch.env` is already optional, so the empty fallback is noise.
    env: { ...(options.env ?? process.env), ...launch.env },
    ...(windowsWorkspace ? { windowsVerbatimArguments: true } : {})
  })

  const stderrTail = createStderrTail()
  child.stderr.on('data', (chunk: Buffer) => stderrTail.append(chunk))
  child.stderr.on('error', () => {
    // A stderr read failure must not take down the main process.
  })

  let settled = false
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    const finish = (code: number | null, signal: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      resolve({ code, signal })
    }
    child.once('close', finish)
    // A failed spawn reports here, never via 'close'.
    child.once('error', () => finish(null, null))
  })

  let closedOnce = false
  const close = async (): Promise<void> => {
    if (closedOnce) {
      return
    }
    closedOnce = true
    try {
      child.stdin.end()
    } catch {
      // Already ended.
    }
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
    await closed
  }

  return {
    writable: toWebWritable(child.stdin),
    readable: toWebReadable(child.stdout),
    closed,
    stderrTail: () => stderrTail.read(),
    close
  }
}

/** Valid POSIX environment-variable name; anything else cannot be set inline. */
const POSIX_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The one remote command line that starts the agent.
 *
 * Why `cd &&` and inline assignments rather than a shell profile: an SSH exec
 * channel runs a non-interactive, non-login shell, so the user's `~/.bashrc`
 * PATH additions are NOT in effect. `command` is resolved by that bare shell,
 * and the user's `env` entries are the supported way to add what it needs.
 */
export function buildRemoteAcpCommand(launch: AcpAgentLaunch, cwd: string | undefined): string {
  const argv = [launch.command.trim(), ...(launch.args ?? [])].map(shellEscape).join(' ')
  const assignments = Object.entries(launch.env ?? {})
    .filter(([name]) => POSIX_ENV_NAME.test(name))
    .map(([name, value]) => `${name}=${shellEscape(value)}`)
  const startup = [...assignments, argv].join(' ')
  return cwd ? `cd ${shellEscape(cwd)} && ${startup}` : startup
}

/**
 * Start an ACP agent on an SSH host over an exec channel.
 *
 * Why an exec channel rather than a remote PTY: ACP is a byte protocol on the
 * agent's stdio, and an exec channel is duplex with a real stdin and a separate
 * stderr. A PTY would merge stderr into stdout and apply terminal line
 * discipline, which corrupts JSON-RPC framing. The remote shell resolves
 * `command` through PATH, so a remote agent is configured the same way a local
 * one is — the command string is the agent.
 */
async function startSshAcpTransport(
  launch: AcpAgentLaunch,
  connectionId: string,
  options: { cwd?: string }
): Promise<AcpTransport> {
  const manager = getSshConnectionManager()
  const connection = manager?.getConnection(connectionId)
  if (!connection || connection.getState().status !== 'connected') {
    throw new Error('The SSH host is not connected. Reconnect it, then start the agent again.')
  }

  // `exec`'s default wrapper runs the line under /bin/sh and keeps stdin open
  // for the channel, which is what lets the ACP client keep talking.
  const channel = await connection.exec(buildRemoteAcpCommand(launch, options.cwd))

  const stderrTail = createStderrTail()
  channel.stderr?.on('data', (chunk: Buffer) => stderrTail.append(chunk))
  channel.stderr?.on('error', () => {
    // A stderr read failure must not take down the main process.
  })

  let settled = false
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    const finish = (code: number | null, signal: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      resolve({ code, signal })
    }
    channel.once('close', (code?: number | null, signal?: string | null) =>
      finish(typeof code === 'number' ? code : null, signal ?? null)
    )
    // A dropped transport reports here, never via 'close'.
    channel.once('error', () => finish(null, null))
  })

  let closedOnce = false
  const close = async (): Promise<void> => {
    if (closedOnce) {
      return
    }
    closedOnce = true
    // Why stdin ends first: EOF is the agent's cue to exit on its own, which is
    // the only way to let it flush. A kill is the bounded fallback.
    try {
      channel.end()
    } catch {
      // Already ended.
    }
    if (await settlesWithin(closed, ACP_CLOSE_GRACE_MS)) {
      return
    }
    try {
      channel.close()
    } catch {
      // Already gone.
    }
    // Why bounded here too: this runs inside the quit barrier, and an agent
    // that ignores both EOF and a channel close must not hang the whole quit.
    await settlesWithin(closed, ACP_CLOSE_GRACE_MS)
  }

  return {
    writable: toWebWritable(channel),
    readable: toWebReadable(channel),
    closed,
    stderrTail: () => stderrTail.read(),
    close
  }
}

/**
 * Start an ACP agent, locally or on an SSH host, and expose its stdio as a
 * byte transport.
 *
 * Why one entry point: the session above it must not branch on where the agent
 * runs. Everything remote-specific lives in how the byte pipe is obtained.
 */
export function startAcpTransport(
  launch: AcpAgentLaunch,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; connectionId?: string } = {}
): AcpTransport | Promise<AcpTransport> {
  if (!launch.command.trim()) {
    throw new Error('ACP agent command is empty')
  }
  return options.connectionId
    ? startSshAcpTransport(launch, options.connectionId, options)
    : startLocalAcpTransport(launch, options)
}