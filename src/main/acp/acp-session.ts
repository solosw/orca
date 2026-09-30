import { client, methods, ndJsonStream, type ClientConnection } from '@agentclientprotocol/sdk'
import type * as acp from '@agentclientprotocol/sdk'
import type {
  AcpCommand,
  AcpMediaItem,
  AcpPermissionDecision,
  AcpPermissionOption,
  AcpPlanEntry,
  AcpSessionEvent,
  AcpSessionStatus,
  AcpSessionSummary
} from '../../shared/acp-types'
import { startAcpTransport, type AcpTransport } from './acp-transport'

/** The protocol version this client speaks. ACP's `ProtocolVersion` is a number. */
export const ACP_PROTOCOL_VERSION = 1

/**
 * How long the ACP handshake may take before the session is declared failed.
 *
 * Why a timeout at all: `initialize` is a request, so an agent that starts,
 * reads stdin, and never answers leaves the promise pending forever. Without
 * this bound, one bad command in a user's config would hang the session until
 * the app was quit — the failure must be a reportable status instead.
 */
export const ACP_HANDSHAKE_TIMEOUT_MS = 15_000

/**
 * How long one prompt turn may run before the client gives up on it.
 *
 * Why not the handshake bound: a handshake is a few round trips, while a real
 * coding turn legitimately runs for minutes. Reusing the 15s handshake bound
 * failed every non-trivial turn. This is only a safety net — the user's own
 * recourse during a long turn is `cancel()`, not waiting for this deadline.
 */
export const ACP_TURN_TIMEOUT_MS = 1024 * 60 * 60_000

/** Wraps a promise so it rejects rather than hanging past the deadline. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const deadline = Date.now() + ms
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const clear = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    const rejectOnDeadline = (): void => {
      if (settled) {
        return
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        settled = true
        reject(new Error(`Timed out after ${ms}ms waiting for ${what}`))
        return
      }
      // Node clamps setTimeout delays above 2^31-1 to roughly 1ms. Chain
      // long deadlines so a generous turn timeout does not expire immediately.
      timer = setTimeout(rejectOnDeadline, Math.min(remaining, 2_147_483_647))
    }
    rejectOnDeadline()
    promise.then(
      (value) => {
        if (settled) {
          return
        }
        settled = true
        clear()
        resolve(value)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clear()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

/**
 * Maps one ACP content block to the reduced media shape the UI takes.
 *
 * Why not pass the SDK's blocks through: the renderer must not depend on the ACP
 * SDK, and only displayable media (a URL or a data URL) is useful here.
 */
function toMediaItems(content: acp.ContentBlock): AcpMediaItem[] {
  if (content.type === 'image' || content.type === 'audio') {
    return [
      {
        kind: content.type,
        url: `data:${content.mimeType};base64,${content.data}`,
        mimeType: content.mimeType
      }
    ]
  }
  if (content.type === 'resource_link') {
    return [
      {
        kind: 'file',
        url: content.uri,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        ...(content.name ? { name: content.name } : {})
      }
    ]
  }
  return []
}

/** Text of one content block; non-text blocks render as media instead. */
function toText(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

function toPlanEntries(entries: acp.PlanEntry[]): AcpPlanEntry[] {
  return entries.map((entry) => ({
    content: entry.content,
    ...(entry.status ? { status: entry.status } : {}),
    ...(entry.priority ? { priority: entry.priority } : {})
  }))
}

function toPermissionOptions(options: acp.PermissionOption[]): AcpPermissionOption[] {
  return options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: option.kind
  }))
}

/**
 * Maps the agent's advertised commands to the `/` menu's row shape.
 *
 * Why the argument hint is read off the structured input: ACP models it as an
 * `UnstructuredCommandInput.hint` today, and a command carrying no input has
 * none — so both cases collapse to the same optional field.
 */
function toCommands(commands: acp.AvailableCommand[]): AcpCommand[] {
  return commands.map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    ...(command.input ? { argumentHint: command.input.hint } : {})
  }))
}

/**
 * Reduce one `session/update` into zero or more UI events.
 *
 * Why a switch over a narrow set: the protocol carries more update kinds than
 * this first version renders (available commands, config options, notices).
 * Dropping them keeps the event stream to kinds the UI can actually draw,
 * rather than teaching the panel about shapes nothing displays.
 */
export function reduceAcpSessionUpdate(update: acp.SessionUpdate): AcpSessionEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'user_message_chunk': {
      const text = toText(update.content)
      const media = toMediaItems(update.content)
      if (!text && media.length === 0) {
        return []
      }
      return [
        {
          kind: 'message',
          role: update.sessionUpdate === 'user_message_chunk' ? 'user' : 'assistant',
          text,
          ...(update.messageId ? { messageId: update.messageId } : {}),
          ...(media.length > 0 ? { media } : {})
        }
      ]
    }
    case 'agent_thought_chunk': {
      const text = toText(update.content)
      const media = toMediaItems(update.content)
      if (!text && media.length === 0) {
        return []
      }
      return [
        {
          kind: 'thought',
          text,
          ...(update.messageId ? { messageId: update.messageId } : {}),
          ...(media.length > 0 ? { media } : {})
        }
      ]
    }
    case 'tool_call':
    case 'tool_call_update': {
      return [
        {
          kind: 'tool_call',
          ...(update.title ? { title: update.title } : {}),
          toolCallId: update.toolCallId,
          ...(update.name ? { name: update.name } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...(update.kind ? { toolKind: update.kind } : {}),
          ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
          ...(update.rawOutput !== undefined ? { output: update.rawOutput } : {}),
          ...(update.content ? { content: update.content } : {})
        }
      ]
    }
    case 'plan':
      return [{ kind: 'plan', entries: toPlanEntries(update.entries) }]
    case 'current_mode_update':
      return [{ kind: 'mode', currentModeId: update.currentModeId }]
    case 'usage_update':
      return [{ kind: 'usage', used: update.used, size: update.size }]
    // The agent's own `/` surface. Dropping it left the composer on its fallback
    // list, so the menu showed two host commands instead of what the agent offers.
    case 'available_commands_update':
      return [{ kind: 'commands', commands: toCommands(update.availableCommands) }]
    // Listed explicitly rather than caught by `default`: the lint rule treats a
    // default as non-exhaustive, so naming each unrendered kind is what makes a
    // NEW protocol version's kind fail the build instead of vanishing silently.
    case 'plan_update':
    case 'plan_removed':
    case 'config_option_update':
    case 'session_info_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
    case 'notice':
      return []
  }
}

export type AcpSessionOptions = {
  sessionId: string
  title: string
  launch: { command: string; args?: readonly string[]; env?: Record<string, string> }
  /** Absolute working directory the agent runs in. */
  cwd: string
  /**
   * SSH connection id. Present means the agent runs on that host, launched over
   * an exec channel instead of a local child process.
   */
  connectionId?: string
  /** Receives every reduced event, in order. */
  onEvent: (sessionId: string, event: AcpSessionEvent) => void
  /** Asks the UI for a decision; resolves when the user answers. */
  onPermissionRequest: (request: {
    requestId: string
    sessionId: string
    title: string
    options: AcpPermissionOption[]
  }) => Promise<AcpPermissionDecision>
  /** Enables the agent's optional `fs/read_text_file`. Absent means "not offered". */
  readTextFile?: (
    absolutePath: string,
    line?: number | null,
    limit?: number | null
  ) => Promise<string>
  /** Enables the agent's optional `fs/write_text_file`. Absent means "not offered". */
  writeTextFile?: (absolutePath: string, content: string) => Promise<void>
}

/**
 * One ACP conversation with a user-defined agent.
 *
 * Lifecycle: `start()` spawns the process and completes the handshake, so a
 * caller can attach event subscribers before any update can arrive. A failed
 * handshake yields a `failed` summary rather than a throw, because "this binary
 * does not speak ACP" is a reportable outcome the UI must show.
 */
export class AcpSession {
  private readonly options: AcpSessionOptions
  private transport: AcpTransport | null = null
  private connection: ClientConnection | null = null
  private agentSessionId: string | null = null
  private modes: AcpSessionSummary['modes']
  private status: AcpSessionStatus = 'starting'
  private error: string | undefined
  private disposed = false
  private cancelActivePrompt: (() => void) | null = null

  constructor(options: AcpSessionOptions) {
    this.options = options
  }

  summary(): AcpSessionSummary {
    return {
      sessionId: this.options.sessionId,
      agentSessionId: this.agentSessionId,
      title: this.options.title,
      status: this.status,
      ...(this.modes ? { modes: this.modes } : {}),
      ...(this.error ? { error: this.error } : {})
    }
  }

  get agentSession(): string | null {
    return this.agentSessionId
  }

  private emit(event: AcpSessionEvent): void {
    this.options.onEvent(this.options.sessionId, event)
  }

  async start(): Promise<AcpSessionSummary> {
    try {
      // A local launch resolves synchronously (a child process spawn), while a
      // remote one opens an SSH exec channel first; awaiting covers both.
      this.transport = await startAcpTransport(this.options.launch, {
        cwd: this.options.cwd,
        ...(this.options.connectionId ? { connectionId: this.options.connectionId } : {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.status = 'failed'
      this.error = message
      this.emit({ kind: 'closed', reason: message })
      return this.summary()
    }

    const transport = this.transport
    // The agent exiting is the only signal covering both a crash and a clean
    // quit, so it is what moves the session out of a live state.
    void transport.closed.then(({ code }) => {
      if (this.disposed) {
        return
      }
      const reason = code === 0 ? 'Agent exited' : `Agent exited with code ${code ?? 'unknown'}`
      this.status = 'exited'
      this.emit({ kind: 'closed', reason })
    })

    const app = client({ name: 'orca' })
      .onNotification(methods.client.session.update, ({ params }) => {
        for (const event of reduceAcpSessionUpdate(params.update)) {
          this.emit(event)
        }
      })
      .onRequest(methods.client.session.requestPermission, async ({ params }) => {
        const decision = await this.options.onPermissionRequest({
          requestId: `${this.options.sessionId}:${params.toolCall.toolCallId}`,
          sessionId: this.options.sessionId,
          title: params.toolCall.title ?? 'Permission required',
          options: toPermissionOptions(params.options)
        })
        return decision.outcome === 'selected'
          ? ({ outcome: { outcome: 'selected', optionId: decision.optionId } } as const)
          : ({ outcome: { outcome: 'cancelled' } } as const)
      })
      .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
        if (!this.options.readTextFile) {
          throw new Error('File reading is not enabled for this session')
        }
        return { content: await this.options.readTextFile(params.path, params.line, params.limit) }
      })
      .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
        if (!this.options.writeTextFile) {
          throw new Error('File writing is not enabled for this session')
        }
        await this.options.writeTextFile(params.path, params.content)
      })

    const connection = app.connect(ndJsonStream(transport.writable, transport.readable))
    this.connection = connection

    try {
      await withTimeout(
        connection.agent.request(methods.agent.initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: Boolean(this.options.readTextFile),
              writeTextFile: Boolean(this.options.writeTextFile)
            }
          }
        }),
        ACP_HANDSHAKE_TIMEOUT_MS,
        'the agent to answer initialize'
      )
      const created = await withTimeout(
        connection.agent.request(methods.agent.session.new, {
          cwd: this.options.cwd,
          mcpServers: []
        }),
        ACP_HANDSHAKE_TIMEOUT_MS,
        'the agent to open a session'
      )
      this.agentSessionId = created.sessionId
      if (created.modes) {
        this.modes = {
          currentModeId: created.modes.currentModeId,
          availableModes: created.modes.availableModes.map((mode) => ({
            id: mode.id,
            name: mode.name,
            ...(mode.description ? { description: mode.description } : {})
          }))
        }
      }
      this.status = 'ready'
      return this.summary()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Why the stderr tail: an agent that speaks no ACP fails here with an
      // opaque protocol error, and its own message is the only useful text.
      const tail = transport.stderrTail()
      this.status = 'failed'
      this.error = tail ? `${message}\n${tail}` : message
      this.emit({ kind: 'closed', reason: this.error })
      await this.close()
      return this.summary()
    }
  }

  /** Asks the agent to switch the current session mode. */
  async setMode(modeId: string): Promise<void> {
    const connection = this.connection
    const agentSessionId = this.agentSessionId
    if (!connection || !agentSessionId) {
      throw new Error(`Cannot change mode for a session in status "${this.status}"`)
    }
    await connection.agent.request('session/set_mode', {
      sessionId: agentSessionId,
      modeId
    } as never)
    if (this.modes) {
      this.modes = { ...this.modes, currentModeId: modeId }
    }
  }

  /** Sends a prompt turn; resolves when the agent reports the turn stopped. */
  async prompt(text: string): Promise<AcpSessionSummary> {
    const connection = this.connection
    const agentSessionId = this.agentSessionId
    if (!connection || !agentSessionId) {
      throw new Error(`Cannot prompt a session in status "${this.status}"`)
    }
    this.status = 'prompting'
    // ACP agents do not necessarily echo the user's prompt as a session update;
    // persist and publish it so the transcript is complete before the reply.
    this.emit({ kind: 'message', role: 'user', text })
    // Why before the request: the sidebar row keys off this event to show the
    // agent working, and a turn that ends in a timeout still ran.
    this.emit({ kind: 'turn_start', text })
    let cancelled = false
    const request = connection.agent.request(methods.agent.session.prompt, {
      sessionId: agentSessionId,
      prompt: [{ type: 'text', text }]
    })
    const cancellation = new Promise<never>((_, reject) => {
      this.cancelActivePrompt = () => {
        cancelled = true
        reject(new Error('ACP turn cancelled'))
      }
    })
    try {
      const response = await withTimeout(
        Promise.race([request, cancellation]),
        // Why a turn-sized bound and not the handshake one: a coding turn runs
        // for minutes, so the 15s handshake deadline failed every real turn.
        ACP_TURN_TIMEOUT_MS,
        'the agent to finish the turn'
      )
      this.emit({ kind: 'turn_end', stopReason: response.stopReason })
      this.status = 'ready'
      this.error = undefined
      return this.summary()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ kind: 'turn_end', stopReason: cancelled ? 'cancelled' : 'error' })
      // Why the session stays usable: a failed turn (a timeout, a rejected
      // prompt) is not a dead transport. Marking the whole session `failed`
      // hid the conversation behind "Could not load conversation" and made the
      // agent look unreachable, when the next turn could simply succeed.
      this.status = 'ready'
      this.error = cancelled ? undefined : message
      return this.summary()
    } finally {
      this.cancelActivePrompt = null
    }
  }

  /** Asks the agent to stop the current turn. Best-effort by protocol design. */
  async cancel(): Promise<void> {
    const connection = this.connection
    const agentSessionId = this.agentSessionId
    if (!connection || !agentSessionId || this.status === 'exited' || this.status === 'failed') {
      return
    }
    // Resolve the local prompt wait first so the UI and sender return immediately;
    // the agent's protocol notification may be delayed or unavailable.
    this.cancelActivePrompt?.()
    await connection.agent.notify(methods.agent.session.cancel, { sessionId: agentSessionId })
  }

  /** Stops the agent process and releases the transport. Idempotent. */
  async close(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const transport = this.transport
    this.transport = null
    this.connection = null
    if (transport) {
      await transport.close()
    }
  }
}
