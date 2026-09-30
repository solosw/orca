/**
 * Shared contract for Orca's ACP (Agent Client Protocol) client.
 *
 * ACP lets Orca drive an arbitrary agent process over JSON-RPC on stdio, so a
 * user-defined agent needs nothing from Orca's built-in `TuiAgent` union: it
 * ships its own binary, and Orca is only the client. That is why nothing here
 * references a base agent — a profile's command *is* the agent.
 */

/** How the ACP agent process is started. */
export type AcpAgentLaunch = {
  /** Absolute path or PATH-resolved command of the ACP-speaking agent binary. */
  command: string
  args?: readonly string[]
  /** Extra environment merged over the inherited environment. */
  env?: Record<string, string>
}

/** A file the agent (or the user) attached to a prompt. */
export type AcpMediaItem = {
  kind: 'image' | 'audio' | 'video' | 'file'
  /** Either an `https?://` URL or a `data:` URL. */
  url: string
  mimeType?: string
  name?: string
}

/**
 * One choice on a `session/request_permission` prompt.
 *
 * Why `kind` is a plain string: ACP defines well-known kinds but the protocol
 * permits agent-defined ones, so narrowing it would reject valid agents. The
 * known values are documented here rather than encoded in the type:
 * `allow_once` | `allow_always` | `reject_once` | `reject_always`.
 */
export type AcpPermissionOption = {
  optionId: string
  name: string
  kind?: string
}

/**
 * One entry of an agent-authored plan (`plan` session update).
 *
 * Why `status`/`priority` are plain strings: ACP allows agent-defined values
 * here too (`status`: `pending` | `in_progress` | `completed`).
 */
export type AcpPlanEntry = {
  content: string
  status?: string
  priority?: string
}

/**
 * One `/` command the agent advertises through `available_commands_update`.
 *
 * Why the reduction rather than the SDK's `AvailableCommand`: the renderer must
 * not depend on the ACP SDK, and the `/` menu needs only a name, a row
 * description and an argument hint.
 */
export type AcpCommand = {
  name: string
  description?: string
  /** The agent's own argument sketch, e.g. `<objective>`. */
  argumentHint?: string
}

/** Current context-window usage reported by ACP. */
export type AcpContextUsage = {
  used: number
  size: number
}

export type AcpSessionMode = {
  id: string
  name: string
  description?: string
}

export type AcpSessionModeState = {
  currentModeId: string
  availableModes: AcpSessionMode[]
}

/**
 * A UI-facing ACP session event.
 *
 * Why a flat event rather than the SDK's own update union: the renderer must not
 * depend on the ACP SDK, and the panel only needs a stable reduced shape. The
 * session reduces every `session/update` kind into this one type.
 */
export type AcpSessionEvent =
  | {
      kind: 'message'
      role: 'assistant' | 'user'
      text: string
      messageId?: string
      media?: AcpMediaItem[]
    }
  | { kind: 'thought'; text: string; messageId?: string; media?: AcpMediaItem[] }
  | {
      kind: 'tool_call'
      title?: string
      toolCallId: string
      name?: string
      status?: string
      toolKind?: string
      input?: unknown
      output?: unknown
      content?: unknown[]
    }
  | { kind: 'plan'; entries: AcpPlanEntry[] }
  | { kind: 'mode'; currentModeId: string }
  | { kind: 'usage'; used: number; size: number }
  /** The agent's current `/` surface, replacing any previously reported one. */
  | { kind: 'commands'; commands: AcpCommand[] }
  /**
   * A prompt turn began.
   *
   * Why an explicit event: the session's `prompting` status is not itself
   * published, and a sidebar row that never sees a turn start cannot show the
   * agent as working. `text` is the user's own prompt, for the row's summary.
   */
  | { kind: 'turn_start'; text: string }
  /** The prompt turn finished; `stopReason` is ACP's own vocabulary. */
  | { kind: 'turn_end'; stopReason: string }
  /** The agent process exited or the transport failed. */
  | { kind: 'closed'; reason: string }

/** A permission request awaiting a user decision. */
export type AcpPermissionRequest = {
  requestId: string
  sessionId: string
  /** Human-readable description of the operation the agent wants to perform. */
  title: string
  options: AcpPermissionOption[]
}

export type AcpPermissionDecision =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

/** Session status as the UI shows it. */
export type AcpSessionStatus = 'starting' | 'ready' | 'prompting' | 'exited' | 'failed'

export type AcpSessionSummary = {
  sessionId: string
  /** Agent-advertised session id (from `session/new`), once known. */
  agentSessionId: string | null
  title: string
  status: AcpSessionStatus
  /** Populated when status is `failed`. */
  error?: string
  /** Modes advertised by the agent for this session, when supported. */
  modes?: AcpSessionModeState
}

/** Longest command string accepted for a launch, matching the custom-agent bound. */
export const ACP_MAX_LAUNCH_COMMAND_LENGTH = 4_000

/** Longest argument string accepted for a launch. */
export const ACP_MAX_LAUNCH_ARGS_LENGTH = 4_000

/** Bounds on a launch arriving over IPC, which is untrusted input to the spawn path. */
export const ACP_MAX_LAUNCH_ARGS_COUNT = 128
export const ACP_MAX_LAUNCH_ENV_ENTRIES = 64
export const ACP_MAX_LAUNCH_ENV_NAME_LENGTH = 200
export const ACP_MAX_LAUNCH_ENV_VALUE_LENGTH = 4_000

/** Longest prompt accepted for one turn; a turn is user-typed text, not a file. */
export const ACP_MAX_PROMPT_LENGTH = 100_000

/** Longest renderer-minted session id and display title accepted. */
export const ACP_MAX_SESSION_ID_LENGTH = 200
export const ACP_MAX_TITLE_LENGTH = 200

/**
 * How long an agent waits for the user's permission answer before Orca cancels.
 *
 * Why a deadline: the agent is blocked on this reply, so a window that reloads
 * (or a user who walks away) would otherwise strand the turn forever. Cancelling
 * is ACP's own "no decision" outcome, so the agent sees a normal rejection.
 */
export const ACP_PERMISSION_TIMEOUT_MS = 5 * 60_000

/** A session's summary plus every event buffered for it, as the IPC layer reads them. */
export type AcpSessionView = {
  summary: AcpSessionSummary
  events: AcpSessionEvent[]
}

/**
 * Renderer → main: everything needed to launch one agent.
 *
 * Why the renderer resolves the profile: the custom-agent list is settings-owned
 * state the UI already reads, so main receives a plain launch descriptor instead
 * of re-deriving one — and the descriptor is validated before it is spawned.
 */
export type AcpSessionStartArgs = {
  /** Renderer-minted, unique per panel; the window that opened it owns the key. */
  sessionId: string
  /** Shown as the session's tab title. */
  title: string
  /** Working directory for the agent process; authorized by main before use. */
  cwd: string
  launch: AcpAgentLaunch
  /**
   * SSH connection id for a remote workspace. Absent means the agent runs on
   * this machine; present means the same command is started on that host, so a
   * remote workspace can define its agents exactly like a local one.
   */
  connectionId?: string
}

export type AcpSessionIdArgs = { sessionId: string }
export type AcpSessionModeArgs = { sessionId: string; modeId: string }
export type AcpSessionPromptArgs = { sessionId: string; text: string }

/** The user's answer to a pending `session/request_permission`. */
export type AcpPermissionResponseArgs = {
  requestId: string
  decision: AcpPermissionDecision
}

/** Main → renderer: one reduced session event, tagged with its session. */
export type AcpSessionEventPayload = {
  sessionId: string
  event: AcpSessionEvent
}
