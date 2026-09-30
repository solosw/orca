import type {
  AcpPermissionDecision,
  AcpSessionEvent,
  AcpSessionSummary,
  AcpSessionView
} from '../../shared/acp-types'
import { AcpSession, type AcpSessionOptions } from './acp-session'

/**
 * Why the view type lives in `shared/acp-types`: the IPC handler returns it and
 * the preload bridge declares it, so one definition is what keeps the three
 * layers from drifting. Re-exported here for the tests that import it locally.
 */
export type { AcpSessionView }

export type AcpSessionCreateArgs = Omit<AcpSessionOptions, 'sessionId' | 'onEvent'> & {
  sessionId: string
}

type Entry = {
  session: AcpSession
  events: AcpSessionEvent[]
}

/**
 * Owns every ACP conversation in this process.
 *
 * Why a manager and not session-per-call: sessions outlive the IPC call that
 * created them (an agent runs for minutes), so something must hold the
 * references, enforce the concurrency bound, and close agents on shutdown.
 */
export class AcpSessionManager {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(sessionId: string, event: AcpSessionEvent) => void>()
  private readonly maxSessions: number

  constructor(options: { maxSessions?: number } = {}) {
    // Why bounded: each session is a live child process. Without a cap, a
    // misbehaving caller can spawn processes until the machine swaps.
    this.maxSessions = options.maxSessions ?? 8
  }

  /** Subscribes to every session's events. Returns an unsubscribe function. */
  subscribe(listener: (sessionId: string, event: AcpSessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  list(): AcpSessionSummary[] {
    return [...this.entries.values()].map((entry) => entry.session.summary())
  }

  /** Events accumulated for a session, or null when it is unknown. */
  view(sessionId: string): AcpSessionView | null {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return null
    }
    return { summary: entry.session.summary(), events: [...entry.events] }
  }

  /**
   * Creates and starts a session. Resolves once the ACP handshake settled, so
   * the caller learns immediately whether the agent actually speaks ACP.
   */
  async create(args: AcpSessionCreateArgs): Promise<AcpSessionSummary> {
    if (this.entries.has(args.sessionId)) {
      throw new Error(`ACP session ${args.sessionId} already exists`)
    }
    if (this.entries.size >= this.maxSessions) {
      throw new Error(
        `Refusing to start another ACP session: the limit of ${this.maxSessions} is reached`
      )
    }

    const events: AcpSessionEvent[] = []
    const session = new AcpSession({
      ...args,
      onEvent: (sessionId, event) => {
        events.push(event)
        for (const listener of this.listeners) {
          listener(sessionId, event)
        }
      }
    })

    this.entries.set(args.sessionId, { session, events })
    try {
      return await session.start()
    } catch (error) {
      // A throw from start() (not a failed summary) must not leak the entry.
      this.entries.delete(args.sessionId)
      throw error
    }
  }

  /** Clears retained transcript events without stopping the agent process. */
  clear(sessionId: string): void {
    this.require(sessionId).events.length = 0
  }

  /** Sends a prompt to a session. */
  async prompt(sessionId: string, text: string): Promise<AcpSessionSummary> {
    return this.require(sessionId).session.prompt(text)
  }

  /** Asks a session's agent to switch mode. */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.require(sessionId).session.setMode(modeId)
  }

  /** Asks a session's agent to stop the current turn. */
  async cancel(sessionId: string): Promise<void> {
    await this.require(sessionId).session.cancel()
  }

  /** Stops one session's agent. Unknown ids are a no-op so double-close is safe. */
  async close(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    this.entries.delete(sessionId)
    await entry.session.close()
  }

  /** Stops every agent. Used on app quit. */
  async closeAll(): Promise<void> {
    const all = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(all.map((entry) => entry.session.close()))
  }

  private require(sessionId: string): Entry {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      throw new Error(`ACP session ${sessionId} not found`)
    }
    return entry
  }
}

export type { AcpPermissionDecision }