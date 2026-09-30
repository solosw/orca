import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACP_CHANNELS } from '../../shared/acp-channels'
import type {
  AcpPermissionRequest,
  AcpSessionEventPayload,
  AcpSessionStartArgs
} from '../../shared/acp-types'
import type { Store } from '../persistence'

const FIXTURE = join(__dirname, '..', 'acp', '__fixtures__', 'scripted-acp-agent.mjs')

/** Either shape main can push to the renderer on the ACP channels. */
type PushedPayload = AcpSessionEventPayload | AcpPermissionRequest

const handlers = new Map<string, (_event: unknown, args: unknown) => unknown>()
const {
  handleMock,
  removeHandlerMock,
  isTrustedUIRendererMock,
  sendToTrustedUIRendererMock,
  authorizeMock,
  getConnectionManagerMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  isTrustedUIRendererMock: vi.fn(),
  sendToTrustedUIRendererMock: vi.fn<(channel: string, payload: PushedPayload) => void>(),
  authorizeMock: vi.fn(),
  getConnectionManagerMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('./ui', () => ({
  isTrustedUIRenderer: isTrustedUIRendererMock,
  sendToTrustedUIRenderer: sendToTrustedUIRendererMock
}))

vi.mock('./filesystem-auth', () => ({
  resolveAuthorizedPath: authorizeMock
}))

// Why mocked: a remote launch reaches a real SSH host through this manager, so
// the stub stands in for the exec channel sshd would give the transport.
vi.mock('./ssh', () => ({
  getSshConnectionManager: getConnectionManagerMock
}))

import { registerAcpHandlers, shutdownAcpSessions } from './acp'

type Handler = (event: unknown, args: unknown) => unknown

function handlerFor(channel: string): Handler {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return handler
}

/** The trusted-renderer event every handler receives. */
const TRUSTED_EVENT = { sender: { id: 1 } }

/**
 * Invokes a handler with an arbitrary payload.
 *
 * Why `unknown` throughout: these handlers parse untrusted IPC input, so the
 * tests must be able to hand them malformed payloads the types forbid. Every
 * assertion below narrows the result with a matcher or a type guard instead of
 * asserting its shape.
 */
function callHandler(channel: string, args: unknown): Promise<unknown> {
  return Promise.resolve(handlerFor(channel)(TRUSTED_EVENT, args))
}

/**
 * The channels the renderer invokes. `event` and `permissionRequest` are
 * main→renderer pushes, so they have no handler and must not be asserted.
 */
const INVOKE_CHANNELS = [
  ACP_CHANNELS.startSession,
  ACP_CHANNELS.prompt,
  ACP_CHANNELS.cancel,
  ACP_CHANNELS.close,
  ACP_CHANNELS.list,
  ACP_CHANNELS.view,
  ACP_CHANNELS.clear,
  ACP_CHANNELS.respondPermission
] as const

/** A launch that starts the scripted agent in the requested mode. */
function launch(mode: string): { command: string; args: string[] } {
  return { command: process.execPath, args: [FIXTURE, mode] }
}

function startArgs(sessionId: string, mode = 'echo'): AcpSessionStartArgs {
  return { sessionId, title: 'Scripted agent', cwd: process.cwd(), launch: launch(mode) }
}

function startSession(
  sessionId: string,
  mode = 'echo',
  overrides: { cwd?: string; connectionId?: string } = {}
): Promise<unknown> {
  return callHandler(ACP_CHANNELS.startSession, { ...startArgs(sessionId, mode), ...overrides })
}

/** Every payload main pushed on the permission channel. */
function pushedPayloads(channel: string): PushedPayload[] {
  return sendToTrustedUIRendererMock.mock.calls
    .filter(([name]) => name === channel)
    .map(([, payload]) => payload)
}

/** Narrows a pushed payload to a permission prompt by its own shape. */
function isPermissionRequest(payload: PushedPayload): payload is AcpPermissionRequest {
  return 'options' in payload
}

/** Narrows a pushed payload to a session event by its own shape. */
function isEventPayload(payload: PushedPayload): payload is AcpSessionEventPayload {
  return 'event' in payload
}

function permissionRequests(): AcpPermissionRequest[] {
  return pushedPayloads(ACP_CHANNELS.permissionRequest).filter(isPermissionRequest)
}

function sessionEvents(sessionId: string): AcpSessionEventPayload[] {
  return pushedPayloads(ACP_CHANNELS.event)
    .filter(isEventPayload)
    .filter((payload) => payload.sessionId === sessionId)
}

/** Accumulates assistant message text, the panel's own reduction of the stream. */
function messageTexts(events: AcpSessionEventPayload[]): string[] {
  const texts: string[] = []
  for (const { event } of events) {
    if (event.kind === 'message') {
      texts.push(event.text)
    }
  }
  return texts
}

/** The `view` reply's event list, read through a guard rather than a cast. */
function viewEvents(view: unknown): unknown[] {
  if (typeof view !== 'object' || view === null || !('events' in view)) {
    throw new Error('Expected a session view')
  }
  const { events } = view
  if (!Array.isArray(events)) {
    throw new Error('Expected the view to carry an event array')
  }
  return events
}

/** The reply the far end of an SSH exec channel would write back. */
function acpReply(id: unknown, result: unknown): Buffer {
  return Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

/**
 * A minimal ACP-speaking agent standing in for the far end of an exec channel.
 *
 * Why a real responder rather than a dumb stub: the capability being proven is
 * that an ACP handshake completes over an SSH exec channel, so the stub must
 * actually answer `initialize` and `session/new` through the same byte pipe.
 */
function createRemoteAgentChannel(): EventEmitter & {
  stderr: EventEmitter
  end: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
} {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    end: vi.fn(),
    close: vi.fn(),
    write: vi.fn()
  })
  channel.write.mockImplementation((chunk: Buffer, callback?: (error?: Error | null) => void) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      const message: unknown = JSON.parse(trimmed)
      if (typeof message !== 'object' || message === null) {
        continue
      }
      const method = 'method' in message ? message.method : undefined
      const id = 'id' in message ? message.id : undefined
      if (method === 'initialize') {
        channel.emit('data', acpReply(id, { protocolVersion: 1, agentCapabilities: {} }))
      } else if (method === 'session/new') {
        channel.emit('data', acpReply(id, { sessionId: 'agent-session-1' }))
      }
    }
    callback?.()
    return true
  })
  return channel
}

describe('registerAcpHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    isTrustedUIRendererMock.mockReset().mockReturnValue(true)
    sendToTrustedUIRendererMock.mockReset()
    authorizeMock.mockReset().mockResolvedValue(process.cwd())
    getConnectionManagerMock.mockReset().mockReturnValue(null)
    handleMock.mockImplementation((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolveAuthorizedPath is mocked above, so no handler ever reads this store.
    registerAcpHandlers({} as Store)
  })

  afterEach(async () => {
    // Every test that starts an agent must not leak it into the next one: the
    // manager holds live child processes and enforces a concurrency bound.
    await shutdownAcpSessions()
  })

  it('registers every invoke channel and clears stale handlers first', () => {
    // Why not every channel: `event`/`permissionRequest` are main→renderer
    // pushes, so they intentionally have no ipcMain handler.
    for (const channel of INVOKE_CHANNELS) {
      expect(handlers.has(channel)).toBe(true)
      expect(removeHandlerMock).toHaveBeenCalledWith(channel)
    }
    for (const pushChannel of [ACP_CHANNELS.event, ACP_CHANNELS.permissionRequest]) {
      expect(handlers.has(pushChannel)).toBe(false)
    }
  })

  it('refuses every mutating channel from an untrusted sender', async () => {
    isTrustedUIRendererMock.mockReturnValue(false)
    for (const channel of [ACP_CHANNELS.startSession, ACP_CHANNELS.prompt, ACP_CHANNELS.close]) {
      await expect(callHandler(channel, startArgs('untrusted'))).rejects.toThrow(
        /only from the Orca window/
      )
    }
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it('rejects a launch without a command before authorizing anything', async () => {
    await expect(
      callHandler(ACP_CHANNELS.startSession, {
        sessionId: 'no-command',
        cwd: process.cwd(),
        launch: { command: '   ' }
      })
    ).rejects.toThrow(/command is required/)
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it('rejects malformed args and env rather than passing them to spawn', async () => {
    const cases: { launch: unknown; message: RegExp }[] = [
      { launch: { command: 'node', args: 'not-an-array' }, message: /args must be an array/ },
      { launch: { command: 'node', args: [1] }, message: /argument must be a string/ },
      { launch: { command: 'node', env: [] }, message: /env must be an object/ },
      { launch: { command: 'node', env: { A: 1 } }, message: /environment value must be a string/ }
    ]
    for (const { launch: bad, message } of cases) {
      await expect(
        callHandler(ACP_CHANNELS.startSession, {
          sessionId: 'bad-launch',
          cwd: process.cwd(),
          launch: bad
        })
      ).rejects.toThrow(message)
    }
  })

  it('rejects a launch whose arguments exceed the count bound', async () => {
    await expect(
      callHandler(ACP_CHANNELS.startSession, {
        sessionId: 'too-many-args',
        cwd: process.cwd(),
        launch: { command: 'node', args: Array.from({ length: 200 }, () => 'x') }
      })
    ).rejects.toThrow(/too many arguments/)
  })

  it('refuses to start when the working directory is not authorized', async () => {
    // Why this matters: the agent inherits this cwd, so an unauthorized path
    // would give the launch a foothold the user never granted.
    authorizeMock.mockRejectedValueOnce(new Error('Access denied: path resolves outside allowed'))
    await expect(startSession('unauthorized')).rejects.toThrow(/Access denied/)
  })

  it('starts a remote agent without requiring a local path authorization', async () => {
    // Why: an SSH host is a different machine with its own filesystem and no
    // Orca-managed allowed roots, so there is no local path to authorize. The
    // remote route is gated on the connection being live instead.
    const channel = createRemoteAgentChannel()
    const exec = vi.fn().mockResolvedValue(channel)
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({ getState: () => ({ status: 'connected' }), exec })
    })

    const summary = await startSession('remote-1', 'echo', {
      cwd: '/srv/app',
      connectionId: 'ssh-1'
    })

    // The handshake completing is the proof that ACP framing works over the
    // SSH exec channel, not just that a command was sent.
    expect(summary).toMatchObject({ status: 'ready', agentSessionId: 'agent-session-1' })
    expect(authorizeMock).not.toHaveBeenCalled()
    // The user's own command is what runs, on that host, in that directory.
    const expected = `cd '/srv/app' && ${[process.execPath, FIXTURE, 'echo']
      .map((part) => `'${part}'`)
      .join(' ')}`
    expect(exec.mock.calls[0][0]).toBe(expected)
  })

  it('pushes remote agent events back to the renderer', async () => {
    const channel = createRemoteAgentChannel()
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({
        getState: () => ({ status: 'connected' }),
        exec: vi.fn().mockResolvedValue(channel)
      })
    })

    await startSession('remote-2', 'echo', { connectionId: 'ssh-1', cwd: '/srv/app' })
    expect(sessionEvents('remote-2').some((payload) => payload.event.kind === 'closed')).toBe(false)
  })

  it('reports a remote launch against a dead connection as a failed session', async () => {
    getConnectionManagerMock.mockReturnValue({ getConnection: () => undefined })
    const summary = await startSession('remote-dead', 'echo', { connectionId: 'ssh-gone' })
    expect(summary).toMatchObject({ status: 'failed' })
    expect(summary).toMatchObject({ error: expect.stringMatching(/not connected/i) })
  })

  it('rejects a non-string connectionId instead of silently going local', async () => {
    // Why: coercing this would run the command on THIS machine, where the same
    // name may exist and do something the user never asked for.
    await expect(
      callHandler(ACP_CHANNELS.startSession, {
        sessionId: 'bad-connection',
        cwd: process.cwd(),
        connectionId: 7,
        launch: { command: 'node' }
      })
    ).rejects.toThrow(/connectionId is required/)
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it('starts a session and reports it as ready once the handshake settles', async () => {
    await startSession('ready-1')
    const summary = await startSession('ready-2')

    expect(summary).toMatchObject({ status: 'ready', agentSessionId: 'agent-session-1' })
    // Both agents are live, so a panel that mounts late can still discover them.
    expect(await callHandler(ACP_CHANNELS.list, undefined)).toHaveLength(2)
  })

  it('pushes events to the renderer and replays them through view', async () => {
    await startSession('streamed')
    await callHandler(ACP_CHANNELS.prompt, { sessionId: 'streamed', text: 'hello' })

    // The push path is what a mounted panel consumes live.
    expect(sessionEvents('streamed').filter((payload) => payload.event.kind === 'message')).toHaveLength(
      3
    )

    // `view` is the replay path for a panel that mounts after the turn.
    const view = await callHandler(ACP_CHANNELS.view, { sessionId: 'streamed' })
    expect(view).toMatchObject({
      summary: { sessionId: 'streamed', status: 'ready' }
    })
    const messages = messageTexts(sessionEvents('streamed'))
    expect(messages).toEqual(['hello', 'echo:hello', '!'])
    expect(viewEvents(view)).toHaveLength(sessionEvents('streamed').length)
  })

  it('reports an unknown session as null rather than throwing', () => {
    // `view` answers off the in-memory registry, so it is a plain (non-promise)
    // reply that the preload bridge resolves for the renderer.
    expect(handlerFor(ACP_CHANNELS.view)(TRUSTED_EVENT, { sessionId: 'never-existed' })).toBeNull()
  })

  it('surfaces a bad command as a failed session instead of a rejected call', async () => {
    // Why: "this binary does not speak ACP" is a reportable outcome the UI shows,
    // not an IPC failure — the panel needs a status, not an exception.
    const summary = await startSession('crashy', 'crash')
    expect(summary).toMatchObject({ status: 'failed' })

    await callHandler(ACP_CHANNELS.close, { sessionId: 'crashy' })
  })

  it('routes a permission prompt to the renderer and applies the allowed answer', async () => {
    await startSession('perms-1', 'perms')
    const prompting = callHandler(ACP_CHANNELS.prompt, { sessionId: 'perms-1', text: 'go' })

    // The request reaches the renderer, which is the only party that can decide.
    await vi.waitFor(() => expect(permissionRequests()).toHaveLength(1))
    const request = permissionRequests()[0]
    expect(request.sessionId).toBe('perms-1')
    expect(request.options.map((option) => option.optionId)).toEqual(['allow', 'reject'])

    await callHandler(ACP_CHANNELS.respondPermission, {
      requestId: request.requestId,
      decision: { outcome: 'selected', optionId: 'allow' }
    })
    await prompting

    // The agent echoes the decision it received, proving the answer round-tripped.
    expect(messageTexts(sessionEvents('perms-1'))).toContain('decision=selected')
  })

  it('fails closed: a malformed answer cancels rather than throwing at a blocked agent', async () => {
    await startSession('perms-2', 'perms')
    const prompting = callHandler(ACP_CHANNELS.prompt, { sessionId: 'perms-2', text: 'go' })

    await vi.waitFor(() => expect(permissionRequests()).toHaveLength(1))
    const request = permissionRequests()[0]
    // A renderer-shaped payload the types forbid: `selected` with no optionId.
    // Sent deliberately, because the handler must survive raw untrusted input.
    await callHandler(ACP_CHANNELS.respondPermission, {
      requestId: request.requestId,
      decision: { outcome: 'selected' }
    })
    await prompting

    expect(messageTexts(sessionEvents('perms-2'))).toContain('decision=cancelled')
  })

  it('ignores a late answer for a request that already settled', () => {
    // Why: a double-click in the permission dialog must not throw out of IPC.
    expect(
      handlerFor(ACP_CHANNELS.respondPermission)(TRUSTED_EVENT, {
        requestId: 'never-pending',
        decision: { outcome: 'cancelled' }
      })
    ).toBeUndefined()
  })

  it('closing a session removes it and stays safe to repeat', async () => {
    await startSession('closable')
    await callHandler(ACP_CHANNELS.close, { sessionId: 'closable' })
    await expect(callHandler(ACP_CHANNELS.close, { sessionId: 'closable' })).resolves.toBeUndefined()
    expect(await callHandler(ACP_CHANNELS.list, undefined)).toEqual([])
  })

  it('rejects a prompt for an unknown session rather than hanging the UI', async () => {
    await expect(callHandler(ACP_CHANNELS.prompt, { sessionId: 'ghost', text: 'hi' })).rejects.toThrow(
      /not found/
    )
  })

  it('rejects a missing prompt text', async () => {
    await startSession('empty-prompt')
    await expect(callHandler(ACP_CHANNELS.prompt, { sessionId: 'empty-prompt' })).rejects.toThrow(
      /prompt text is required/
    )
  })
})