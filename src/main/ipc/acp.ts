import { ipcMain } from 'electron'
import type {
  AcpAgentLaunch,
  AcpPermissionDecision,
  AcpPermissionRequest,
  AcpSessionEventPayload,
  AcpSessionSummary,
  AcpSessionView
} from '../../shared/acp-types'
import {
  ACP_MAX_LAUNCH_ARGS_COUNT,
  ACP_MAX_LAUNCH_ARGS_LENGTH,
  ACP_MAX_LAUNCH_COMMAND_LENGTH,
  ACP_MAX_LAUNCH_ENV_ENTRIES,
  ACP_MAX_LAUNCH_ENV_NAME_LENGTH,
  ACP_MAX_LAUNCH_ENV_VALUE_LENGTH,
  ACP_MAX_PROMPT_LENGTH,
  ACP_MAX_SESSION_ID_LENGTH,
  ACP_MAX_TITLE_LENGTH,
  ACP_PERMISSION_TIMEOUT_MS
} from '../../shared/acp-types'
import { ACP_CHANNELS } from '../../shared/acp-channels'
import type { Store } from '../persistence'
import { AcpSessionManager } from '../acp/acp-session-manager'
import { resolveAuthorizedPath } from './filesystem-auth'
import { isTrustedUIRenderer, sendToTrustedUIRenderer } from './ui'

/**
 * Every ACP conversation in this process, plus the permission requests awaiting
 * a user decision.
 *
 * Why module state rather than a parameter: the manager outlives every IPC call
 * that touches it (an agent runs for minutes), and quit teardown must reach the
 * same instance to stop those processes.
 */
const manager = new AcpSessionManager()

type PendingPermission = {
  sessionId: string
  settle: (decision: AcpPermissionDecision) => void
}

const pendingPermissions = new Map<string, PendingPermission>()

let unsubscribeEvents: (() => void) | null = null

/** Reads one property off an untrusted IPC payload without asserting its type. */
function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/**
 * Validates the launch descriptor before it reaches the spawn path.
 *
 * Why validate here rather than trust the settings shape: this payload arrives
 * over IPC from the renderer, and the command is executed. Bounding each field
 * is what stops a compromised or buggy renderer from handing `spawnProcess` a
 * megabyte argv or an `env` that overrides the process's own environment.
 */
function parseLaunch(value: unknown): AcpAgentLaunch {
  const command = readField(value, 'command')
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Invalid ACP launch: command is required')
  }
  if (command.length > ACP_MAX_LAUNCH_COMMAND_LENGTH) {
    throw new Error('Invalid ACP launch: command is too long')
  }

  const rawArgs = readField(value, 'args')
  let args: string[] | undefined
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs)) {
      throw new Error('Invalid ACP launch: args must be an array')
    }
    if (rawArgs.length > ACP_MAX_LAUNCH_ARGS_COUNT) {
      throw new Error('Invalid ACP launch: too many arguments')
    }
    const parsed: string[] = []
    for (const arg of rawArgs) {
      if (typeof arg !== 'string') {
        throw new Error('Invalid ACP launch: every argument must be a string')
      }
      if (arg.length > ACP_MAX_LAUNCH_ARGS_LENGTH) {
        throw new Error('Invalid ACP launch: an argument is too long')
      }
      parsed.push(arg)
    }
    args = parsed
  }

  const rawEnv = readField(value, 'env')
  let env: Record<string, string> | undefined
  if (rawEnv !== undefined) {
    if (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv)) {
      throw new Error('Invalid ACP launch: env must be an object')
    }
    const entries = Object.entries(rawEnv)
    if (entries.length > ACP_MAX_LAUNCH_ENV_ENTRIES) {
      throw new Error('Invalid ACP launch: too many environment entries')
    }
    const parsed: Record<string, string> = {}
    for (const [name, entry] of entries) {
      if (typeof entry !== 'string') {
        throw new Error('Invalid ACP launch: every environment value must be a string')
      }
      if (name.length > ACP_MAX_LAUNCH_ENV_NAME_LENGTH) {
        throw new Error('Invalid ACP launch: an environment name is too long')
      }
      parsed[name] = entry.slice(0, ACP_MAX_LAUNCH_ENV_VALUE_LENGTH)
    }
    env = parsed
  }

  return { command, ...(args ? { args } : {}), ...(env ? { env } : {}) }
}

function parseBoundedString(value: unknown, what: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ACP request: ${what} is required`)
  }
  if (value.length > maxLength) {
    throw new Error(`Invalid ACP request: ${what} is too long`)
  }
  return value
}

function parseSessionId(args: unknown): string {
  return parseBoundedString(readField(args, 'sessionId'), 'sessionId', ACP_MAX_SESSION_ID_LENGTH)
}

/**
 * The SSH connection this launch targets, or undefined for a local agent.
 *
 * Why reject a non-string instead of coercing: coercing would silently route a
 * remote launch to the LOCAL machine, where the same command may exist and run
 * something the user did not ask for.
 */
function parseOptionalConnectionId(args: unknown): string | undefined {
  const connectionId = readField(args, 'connectionId')
  if (connectionId === undefined || connectionId === null) {
    return undefined
  }
  return parseBoundedString(connectionId, 'connectionId', ACP_MAX_SESSION_ID_LENGTH)
}

/**
 * The renderer's answer to a permission prompt, or `cancelled` when the payload
 * is malformed.
 *
 * Why fail closed instead of throwing: the agent is blocked awaiting this reply.
 * A malformed answer must still unblock it, and ACP's "cancelled" outcome is
 * exactly the protocol's way of saying "no decision was made".
 */
function parsePermissionDecision(value: unknown): AcpPermissionDecision {
  const outcome = readField(value, 'outcome')
  if (outcome === 'selected') {
    const optionId = readField(value, 'optionId')
    if (typeof optionId === 'string' && optionId.length > 0) {
      return { outcome: 'selected', optionId }
    }
    return { outcome: 'cancelled' }
  }
  return { outcome: 'cancelled' }
}

/**
 * Asks the renderer for a decision and waits for its answer.
 *
 * Why the timeout resolves as `cancelled` rather than rejecting: the agent is
 * blocked on this call, so an unanswered prompt (a reloaded window, a user who
 * walked away) would strand the turn forever. Cancelling is the protocol's own
 * no-decision outcome, so the agent sees a normal rejection.
 */
function requestPermission(request: AcpPermissionRequest): Promise<AcpPermissionDecision> {
  return new Promise<AcpPermissionDecision>((resolve) => {
    const settle = (decision: AcpPermissionDecision): void => {
      if (!pendingPermissions.has(request.requestId)) {
        return
      }
      pendingPermissions.delete(request.requestId)
      clearTimeout(timer)
      resolve(decision)
    }
    const timer = setTimeout(
      () => settle({ outcome: 'cancelled' }),
      ACP_PERMISSION_TIMEOUT_MS
    )
    pendingPermissions.set(request.requestId, { sessionId: request.sessionId, settle })
    sendToTrustedUIRenderer(ACP_CHANNELS.permissionRequest, request)
  })
}

/** Answers a pending prompt; unknown ids are a no-op so a late answer is safe. */
function respondToPermission(requestId: string, decision: AcpPermissionDecision): void {
  pendingPermissions.get(requestId)?.settle(decision)
}

/** Drops every prompt belonging to a session, cancelling each one. */
function cancelPermissionsForSession(sessionId: string): void {
  // Why `Array.from` and not a live iteration: `settle` deletes from the map,
  // and mutating a Map while iterating it skips entries.
  for (const [requestId, pending] of Array.from(pendingPermissions)) {
    if (pending.sessionId === sessionId) {
      pending.settle({ outcome: 'cancelled' })
      pendingPermissions.delete(requestId)
    }
  }
}

function publishEvent(payload: AcpSessionEventPayload): void {
  sendToTrustedUIRenderer(ACP_CHANNELS.event, payload)
}

export function registerAcpHandlers(store: Store): void {
  for (const channel of Object.values(ACP_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }

  // One subscription for every session: the manager fans out to it, and the
  // renderer routes by sessionId. Nothing here holds per-session renderer state,
  // so a window that reloads simply re-subscribes through `view`.
  unsubscribeEvents?.()
  unsubscribeEvents = manager.subscribe((sessionId, event) => {
    publishEvent({ sessionId, event })
  })

  ipcMain.handle(ACP_CHANNELS.startSession, async (event, rawArgs): Promise<AcpSessionSummary> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    const sessionId = parseSessionId(rawArgs)
    const cwd = parseBoundedString(readField(rawArgs, 'cwd'), 'cwd', 4_096)
    const title =
      typeof readField(rawArgs, 'title') === 'string'
        ? parseBoundedString(readField(rawArgs, 'title'), 'title', ACP_MAX_TITLE_LENGTH)
        : 'Custom agent'
    const launch = parseLaunch(readField(rawArgs, 'launch'))
    const connectionId = parseOptionalConnectionId(rawArgs)

    // Why only the local case is authorized here: an SSH host is a different
    // machine with its own filesystem and no Orca-managed allowed roots, so
    // there is nothing local to authorize. The remote side is instead gated on
    // the connection being live, which the transport enforces.
    if (!connectionId) {
      await resolveAuthorizedPath(cwd, store)
    }

    return manager.create({
      sessionId,
      title,
      cwd,
      launch,
      ...(connectionId ? { connectionId } : {}),
      onPermissionRequest: (request) => requestPermission(request)
    })
  })

  ipcMain.handle(ACP_CHANNELS.prompt, async (event, rawArgs): Promise<AcpSessionSummary> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    const sessionId = parseSessionId(rawArgs)
    const text = parseBoundedString(readField(rawArgs, 'text'), 'prompt text', ACP_MAX_PROMPT_LENGTH)
    return manager.prompt(sessionId, text)
  })

  ipcMain.handle(ACP_CHANNELS.setMode, async (event, rawArgs): Promise<void> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    const sessionId = parseSessionId(rawArgs)
    const modeId = parseBoundedString(readField(rawArgs, 'modeId'), 'modeId', 200)
    await manager.setMode(sessionId, modeId)
  })

  ipcMain.handle(ACP_CHANNELS.cancel, async (event, rawArgs): Promise<void> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    await manager.cancel(parseSessionId(rawArgs))
  })

  ipcMain.handle(ACP_CHANNELS.close, async (event, rawArgs): Promise<void> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    const sessionId = parseSessionId(rawArgs)
    // Why before the close: the agent may be blocked on this very prompt, and
    // closing the transport without answering leaves the promise dangling.
    cancelPermissionsForSession(sessionId)
    await manager.close(sessionId)
  })

  ipcMain.handle(ACP_CHANNELS.list, (): AcpSessionSummary[] => manager.list())

  ipcMain.handle(ACP_CHANNELS.view, (_event, rawArgs): AcpSessionView | null =>
    manager.view(parseSessionId(rawArgs))
  )

  ipcMain.handle(ACP_CHANNELS.clear, async (event, rawArgs): Promise<void> => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    manager.clear(parseSessionId(rawArgs))
  })

  ipcMain.handle(ACP_CHANNELS.respondPermission, (event, rawArgs): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      throw new Error('ACP requests are accepted only from the Orca window')
    }
    const requestId = parseBoundedString(
      readField(rawArgs, 'requestId'),
      'requestId',
      ACP_MAX_SESSION_ID_LENGTH * 2
    )
    respondToPermission(requestId, parsePermissionDecision(readField(rawArgs, 'decision')))
  })
}

/**
 * Stops every agent at quit.
 *
 * Why it exists: each session is a live child process, so a quit that skipped
 * this would leave agents running with no client — and on Windows, holding the
 * files Orca is trying to flush.
 */
export async function shutdownAcpSessions(): Promise<void> {
  for (const requestId of Array.from(pendingPermissions.keys())) {
    respondToPermission(requestId, { outcome: 'cancelled' })
  }
  unsubscribeEvents?.()
  unsubscribeEvents = null
  await manager.closeAll()
}