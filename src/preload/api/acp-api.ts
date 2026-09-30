import type {
  AcpPermissionRequest,
  AcpPermissionResponseArgs,
  AcpSessionEventPayload,
  AcpSessionIdArgs,
  AcpSessionModeArgs,
  AcpSessionPromptArgs,
  AcpSessionStartArgs,
  AcpSessionSummary,
  AcpSessionView
} from '../../shared/acp-types'

/**
 * The renderer's view of Orca's ACP client.
 *
 * Why the renderer hands over a whole launch descriptor: custom agents are
 * settings-owned state the UI already has, and the alternative — main re-reading
 * and re-resolving the profile — would duplicate the resolution rule in two
 * processes. Main still validates and authorizes every field before spawning.
 */
export type AcpApi = {
  /** Starts an agent and completes the ACP handshake before resolving. */
  startSession: (args: AcpSessionStartArgs) => Promise<AcpSessionSummary>
  /** Sends one prompt turn; resolves when the agent reports the turn stopped. */
  prompt: (args: AcpSessionPromptArgs) => Promise<AcpSessionSummary>
  /** Sends a mode change request to the agent. */
  setMode: (args: AcpSessionModeArgs) => Promise<void>
  /** Asks the agent to stop the current turn. */
  cancel: (args: AcpSessionIdArgs) => Promise<void>
  /** Stops one agent. Safe to call twice. */
  close: (args: AcpSessionIdArgs) => Promise<void>
  /** Every live session, for a panel that mounts after the agent started. */
  list: () => Promise<AcpSessionSummary[]>
  /** A session's summary plus every event buffered for it, or null when unknown. */
  view: (args: AcpSessionIdArgs) => Promise<AcpSessionView | null>
  /** Removes retained transcript events without stopping the agent. */
  clear: (args: AcpSessionIdArgs) => Promise<void>
  /** Answers a pending permission prompt. */
  respondPermission: (args: AcpPermissionResponseArgs) => Promise<void>
  /** One reduced session event. Returns an unsubscribe function. */
  onEvent: (callback: (payload: AcpSessionEventPayload) => void) => () => void
  /** The agent is asking for a permission decision. */
  onPermissionRequest: (callback: (request: AcpPermissionRequest) => void) => () => void
}