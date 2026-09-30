import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AcpCommand,
  AcpContextUsage,
  AcpPermissionDecision,
  AcpPermissionRequest,
  AcpPlanEntry,
  AcpSessionEvent,
  AcpSessionEventPayload,
  AcpSessionModeState,
  AcpSessionSummary
} from '../../../../shared/acp-types'
import { metadataFromAcpEvents } from './acp-session-metadata'

export type AcpSessionState = {
  summary: AcpSessionSummary | null
  /** The ACP events exactly as received, in protocol order. */
  events: AcpSessionEvent[]
  permission: AcpPermissionRequest | null
  commands: AcpCommand[] | undefined
  contextUsage: AcpContextUsage | null
  plan: AcpPlanEntry[] | null
  modes: AcpSessionModeState | null
  busy: boolean
  error: string | null
}

export type AcpSessionController = AcpSessionState & {
  send: (text: string) => Promise<void>
  clear: () => Promise<void>
  setMode: (modeId: string) => Promise<void>
  cancel: () => Promise<void>
  respondPermission: (decision: AcpPermissionDecision) => Promise<void>
}

const ACP_VIEW_RETRY_MS = 250
const ACP_VIEW_MAX_RETRIES = 20
const ACP_VIEW_TIMEOUT_MS = 8_000

/**
 * Keeps ACP transport events intact; only metadata is projected into panel state.
 *
 * Why no visibility gate: the panel stays mounted under RetainedPaneHost when the
 * user switches worktree or tab. Unsubscribing while hidden dropped live events,
 * and hasReplayedRef then blocked a view resync — the agent kept working in main,
 * but the background panel only caught up after a full remount.
 */
export function useAcpSession(sessionId: string): AcpSessionController {
  const [summary, setSummary] = useState<AcpSessionSummary | null>(null)
  const [events, setEvents] = useState<AcpSessionEvent[]>([])
  const [permission, setPermission] = useState<AcpPermissionRequest | null>(null)
  const [commands, setCommands] = useState<AcpCommand[] | undefined>(undefined)
  const [contextUsage, setContextUsage] = useState<AcpContextUsage | null>(null)
  const [plan, setPlan] = useState<AcpPlanEntry[] | null>(null)
  const [modes, setModes] = useState<AcpSessionModeState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const replayingRef = useRef(false)
  const hasReplayedRef = useRef(false)
  const replayAttemptRef = useRef(0)
  const replayTimerRef = useRef<number | undefined>(undefined)
  const replayQueueRef = useRef<AcpSessionEventPayload[]>([])

  const applyEventMetadata = useCallback((event: AcpSessionEvent): void => {
    switch (event.kind) {
      case 'commands':
        setCommands(event.commands)
        break
      case 'usage':
        setContextUsage({ used: event.used, size: event.size })
        break
      case 'plan':
        setPlan(event.entries)
        break
      case 'mode':
        setModes((current) => (current ? { ...current, currentModeId: event.currentModeId } : current))
        break
      case 'turn_start':
        // Keep status live while the panel is backgrounded: send() sets prompting
        // optimistically, but a turn that started before mount (or after a missed
        // optimistic update) would otherwise leave the row looking idle.
        setSummary((current) => (current ? { ...current, status: 'prompting' } : current))
        setBusy(true)
        break
      case 'turn_end':
      case 'closed':
        setSummary((current) => (current ? { ...current, status: 'ready' } : current))
        setBusy(false)
        break
      default:
        break
    }
  }, [])

  const append = useCallback(
    (payload: AcpSessionEventPayload, options?: { queueDuringReplay?: boolean }): void => {
      if (replayingRef.current && options?.queueDuringReplay !== false) {
        replayQueueRef.current.push(payload)
        return
      }
      applyEventMetadata(payload.event)
      setEvents((current) => [...current, payload.event])
    },
    [applyEventMetadata]
  )

  useEffect(() => {
    let live = true
    const unsubscribeEvent = window.api.acp.onEvent((payload) => {
      if (live && payload.sessionId === sessionIdRef.current) {
        append(payload)
      }
    })
    const unsubscribePermission = window.api.acp.onPermissionRequest((request) => {
      if (live && request.sessionId === sessionIdRef.current) {
        setPermission(request)
      }
    })
    return () => {
      live = false
      unsubscribeEvent()
      unsubscribePermission()
    }
  }, [append])

  const summaryStatus = summary?.status
  useEffect(() => {
    if (!sessionId || hasReplayedRef.current) {
      return
    }
    if (summaryStatus !== 'starting') {
      replayAttemptRef.current = 0
    }

    let live = true
    const loadView = async (): Promise<void> => {
      if (!live || replayingRef.current || hasReplayedRef.current) {
        return
      }
      replayingRef.current = true
      let timeoutHandle: number | undefined
      try {
        const view = await Promise.race([
          window.api.acp.view({ sessionId }),
          new Promise<null>((resolve) => {
            timeoutHandle = window.setTimeout(() => resolve(null), ACP_VIEW_TIMEOUT_MS)
          })
        ])
        if (timeoutHandle !== undefined) {
          window.clearTimeout(timeoutHandle)
          timeoutHandle = undefined
        }
        if (!live) {
          return
        }
        if (!view) {
          replayingRef.current = false
          if (replayAttemptRef.current < ACP_VIEW_MAX_RETRIES) {
            replayAttemptRef.current += 1
            replayTimerRef.current = window.setTimeout(() => void loadView(), ACP_VIEW_RETRY_MS)
          } else {
            setError('无法读取 ACP 会话记录：会话尚未就绪或已不存在')
          }
          return
        }

        const replayed = view.events
        const metadata = metadataFromAcpEvents(replayed, view.summary.modes ?? null)
        setSummary(view.summary)
        setEvents(replayed)
        setCommands(metadata.commands)
        setContextUsage(metadata.contextUsage)
        setPlan(metadata.plan)
        setModes(metadata.modes)

        if (view.summary.status === 'starting') {
          replayingRef.current = false
          replayAttemptRef.current = 0
          replayTimerRef.current = window.setTimeout(() => void loadView(), ACP_VIEW_RETRY_MS)
          return
        }

        hasReplayedRef.current = true
        const queuedEvents = replayQueueRef.current
        replayQueueRef.current = []
        replayingRef.current = false
        for (const queuedEvent of queuedEvents) {
          append(queuedEvent)
        }
        setError(null)
      } catch (err: unknown) {
        replayingRef.current = false
        const queuedEvents = replayQueueRef.current
        replayQueueRef.current = []
        for (const queuedEvent of queuedEvents) {
          append(queuedEvent)
        }
        if (live) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    replayTimerRef.current = window.setTimeout(
      () => void loadView(),
      summaryStatus ? 250 : 0
    )
    return () => {
      live = false
      if (replayTimerRef.current !== undefined) {
        window.clearTimeout(replayTimerRef.current)
        replayTimerRef.current = undefined
      }
    }
  }, [append, sessionId, summaryStatus])

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (!trimmed) {
        return
      }
      setBusy(true)
      // Why optimistic rather than waiting for the prompt to resolve: the IPC
      // `prompt` call resolves only when the agent finishes the turn, so the
      // summary stayed `ready` for the whole turn and the panel never showed the
      // agent as working. The turn_start event is the usual signal, but it can be
      // missed (a replay, a silent agent), so the local status is set here too.
      setSummary((current) => (current ? { ...current, status: 'prompting' } : current))
      try {
        setSummary(await window.api.acp.prompt({ sessionId, text: trimmed }))
        setError(null)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
        setSummary((current) =>
          current ? { ...current, status: 'ready' } : current
        )
      } finally {
        setBusy(false)
      }
    },
    [sessionId]
  )

  const clear = useCallback(async (): Promise<void> => {
    await window.api.acp.clear({ sessionId })
    setEvents([])
    setCommands(undefined)
    setContextUsage(null)
    setPlan(null)
    setError(null)
  }, [sessionId])

  const setMode = useCallback(
    async (modeId: string): Promise<void> => {
      try {
        await window.api.acp.setMode({ sessionId, modeId })
        setModes((current) => (current ? { ...current, currentModeId: modeId } : current))
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [sessionId]
  )

  const cancel = useCallback(async (): Promise<void> => {
    try {
      await window.api.acp.cancel({ sessionId })
      setBusy(false)
      setSummary((current) =>
        current ? { ...current, status: 'ready', error: undefined } : current
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [sessionId])

  const respondPermission = useCallback(
    async (decision: AcpPermissionDecision): Promise<void> => {
      const pending = permission
      if (!pending) {
        return
      }
      setPermission(null)
      try {
        await window.api.acp.respondPermission({ requestId: pending.requestId, decision })
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [permission]
  )

  return useMemo(
    () => ({
      summary,
      events,
      permission,
      commands,
      contextUsage,
      plan,
      modes,
      busy,
      error,
      send,
      clear,
      setMode,
      cancel,
      respondPermission
    }),
    [
      summary,
      events,
      permission,
      commands,
      contextUsage,
      plan,
      modes,
      busy,
      error,
      send,
      clear,
      setMode,
      cancel,
      respondPermission
    ]
  )
}
