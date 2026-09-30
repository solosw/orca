import { ArrowDown } from 'lucide-react'
import { Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AcpContextUsage,
  AcpMediaItem,
  AcpPlanEntry,
  AcpSessionEvent,
  AcpSessionStatus
} from '../../../../shared/acp-types'
import { NativeChatApprovalCard } from '../native-chat/NativeChatApprovalCard'
import {
  NativeChatComposer,
  type NativeChatComposerHandle
} from '../native-chat/NativeChatComposer'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'
import { NativeChatMessageRail } from '../native-chat/NativeChatMessageRail'
import { NATIVE_CHAT_RAIL_MIN_WIDTH_PX } from '../native-chat/use-native-chat-message-rail'
import {
  NATIVE_CHAT_RAIL_MIN_ITEMS,
  selectNativeChatRailTicks,
  type NativeChatRailItem
} from '../native-chat/native-chat-message-rail-items'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import './acp-session-panel.css'
import { useAcpSession } from './use-acp-session'

function statusLabel(status: string | undefined): string {
  return status?.replaceAll('_', ' ') || 'pending'
}

function mediaLabel(media: AcpMediaItem): string {
  return media.name || media.kind
}

function AcpMedia({ media }: { media: readonly AcpMediaItem[] }): React.JSX.Element | null {
  if (media.length === 0) {
    return null
  }
  return (
    <div className="acp-media-list">
      {media.map((item, index) => {
        if (item.kind === 'image') {
          return (
            <img
              key={`${item.url}-${index}`}
              src={item.url}
              alt={item.name || 'ACP image'}
              className="max-h-72 max-w-full rounded-md border border-border/60 object-contain"
            />
          )
        }
        if (item.kind === 'audio') {
          return <audio key={`${item.url}-${index}`} controls src={item.url} className="max-w-full" />
        }
        if (item.kind === 'video') {
          return (
            <video
              key={`${item.url}-${index}`}
              controls
              src={item.url}
              className="max-h-72 max-w-full rounded-md border border-border/60"
            />
          )
        }
        return (
          <a
            key={`${item.url}-${index}`}
            href={item.url}
            className="text-xs text-primary underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {mediaLabel(item)}
          </a>
        )
      })}
    </div>
  )
}

function mergeAcpTranscriptChunks(events: readonly AcpSessionEvent[]): AcpSessionEvent[] {
  const merged: AcpSessionEvent[] = []
  for (const event of events) {
    const previous = merged.at(-1)
    const sameMessage =
      previous?.kind === 'message' &&
      event.kind === 'message' &&
      previous.role === event.role &&
      (previous.messageId === event.messageId || (!previous.messageId && !event.messageId))
    const sameThought =
      previous?.kind === 'thought' &&
      event.kind === 'thought' &&
      (previous.messageId === event.messageId || (!previous.messageId && !event.messageId))
    if (sameMessage || sameThought) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + event.text,
        media: [...(previous.media ?? []), ...(event.media ?? [])]
      }
      continue
    }
    merged.push(event)
  }
  return merged
}

function selectAcpTranscriptEvents(
  events: readonly AcpSessionEvent[],
  active: boolean
): AcpSessionEvent[] {
  const lastTurnStart = events.findLastIndex((event) => event.kind === 'turn_start')
  const lastUserMessage = events.findLastIndex((event) => event.kind === 'message' && event.role === 'user')
  const currentTurnStart = active ? Math.max(lastTurnStart, lastUserMessage) : events.length
  const selected: AcpSessionEvent[] = []
  const toolIndexes = new Map<string, number>()
  for (const [index, event] of events.entries()) {
    const isConversation = event.kind === 'message' || event.kind === 'thought' || event.kind === 'closed'
    const isCurrentTool = active && event.kind === 'tool_call' && index > currentTurnStart
    if (isConversation) {
      selected.push(event)
    } else if (isCurrentTool) {
      const previousIndex = toolIndexes.get(event.toolCallId)
      const nextEvent = { ...event }
      if (previousIndex === undefined) {
        toolIndexes.set(event.toolCallId, selected.length)
        selected.push(nextEvent)
      } else {
        selected[previousIndex] = {
          ...selected[previousIndex],
          ...nextEvent
        }
      }
    }
  }
  return selected
}

function AcpMessageEvent({ event, eventIndex }: { event: Extract<AcpSessionEvent, { kind: 'message' }>; eventIndex: number }) {
  const isUser = event.role === 'user'
  return (
    <div className={`acp-message-row ${isUser ? 'is-user' : 'is-assistant'}`} data-acp-event-kind="message" data-acp-event-index={eventIndex}>
      <div className={isUser ? 'acp-message acp-message-user' : 'acp-message acp-message-assistant'}>
        {event.text ? (
          isUser ? (
            <div className="acp-plain-text">{event.text}</div>
          ) : (
            <CommentMarkdown content={event.text} variant="document" className="text-sm" />
          )
        ) : null}
        <AcpMedia media={event.media ?? []} />
      </div>
    </div>
  )
}

function AcpThoughtEvent({ event }: { event: Extract<AcpSessionEvent, { kind: 'thought' }> }) {
  return (
    <details className="acp-thought" data-acp-event-kind="thought">
      <summary className="acp-thought-summary">Agent thought</summary>
      {event.text ? <pre className="acp-thought-body">{event.text}</pre> : null}
      <AcpMedia media={event.media ?? []} />
    </details>
  )
}

function formatToolValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function AcpToolValue({ label, value }: { label: string; value: unknown }): React.JSX.Element | null {
  if (value === undefined) {
    return null
  }
  return (
    <div className="acp-tool-call-value">
      <div className="acp-tool-call-value-label">{label}</div>
      <pre>{formatToolValue(value)}</pre>
    </div>
  )
}

function AcpToolCallEvent({ event }: { event: Extract<AcpSessionEvent, { kind: 'tool_call' }> }) {
  return (
    <details className="acp-tool-call" data-acp-event-kind="tool_call">
      <summary className="acp-tool-call-summary">
        <div className="acp-tool-call-header">
          <span className="acp-tool-call-name">
            {event.title || event.name || event.toolCallId}
          </span>
          <span className="acp-tool-call-status">{statusLabel(event.status)}</span>
        </div>
      </summary>
      {event.name && event.title ? <div className="acp-tool-call-detail">{event.name}</div> : null}
      <AcpToolValue label="Input" value={event.input} />
      <AcpToolValue label="Output" value={event.output} />
      <AcpToolValue label="Content" value={event.content} />
    </details>
  )
}

function AcpEvent({ event, eventIndex }: { event: AcpSessionEvent; eventIndex: number }): React.JSX.Element | null {
  switch (event.kind) {
    case 'message':
      return <AcpMessageEvent event={event} eventIndex={eventIndex} />
    case 'thought':
      return <AcpThoughtEvent event={event} />
    case 'tool_call':
      return <AcpToolCallEvent event={event} />
    case 'closed':
      return <div className="acp-closed-event">{event.reason}</div>
    case 'turn_start':
    case 'turn_end':
    case 'plan':
    case 'mode':
    case 'usage':
    case 'commands':
      return null
  }
}

function AcpPlanList({ plan }: { plan: readonly AcpPlanEntry[] }): React.JSX.Element {
  return (
    <section className="acp-plan" aria-label="Plan">
      <div className="acp-plan-title">Plan</div>
      <ol className="acp-plan-list">
        {plan.map((entry, index) => (
          <li key={`${index}-${entry.content}`} className="acp-plan-item">
            <span className="acp-plan-index">{index + 1}.</span>
            <span className="acp-plan-content">{entry.content}</span>
            <span className="acp-plan-status">{statusLabel(entry.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function AcpWorkPanel({
  events,
  status,
  hasConversation,
  onClear
}: {
  events: readonly AcpSessionEvent[]
  status: AcpSessionStatus
  hasConversation: boolean
  onClear: () => void
}): React.JSX.Element | null {
  const toolCalls = useMemo(() => {
    const calls = new Map<string, Extract<AcpSessionEvent, { kind: 'tool_call' }>>()
    for (const event of events) {
      if (event.kind === 'tool_call') {
        calls.set(event.toolCallId, { ...calls.get(event.toolCallId), ...event })
      }
    }
    return [...calls.values()]
  }, [events])
  const lastTurn = events.toReversed().find((event) => event.kind === 'turn_start' || event.kind === 'turn_end')
  const active = status === 'prompting' || lastTurn?.kind === 'turn_start'
  // Why `active` also counts: on the first prompt no turn event and no message has
  // landed yet, so a panel gated only on history stayed hidden — the agent looked
  // idle from the moment the user pressed send until its first chunk arrived.
  // landed yet, so a panel gated only on history stayed hidden — the agent looked
  // idle from the moment the user pressed send until its first chunk arrived.
  const hasWorkState = Boolean(lastTurn) || toolCalls.length > 0 || hasConversation || active
  const [open, setOpen] = useState(active)
  useEffect(() => {
    setOpen(active)
  }, [active])
  if (!hasWorkState) {
    return null
  }

  return (
    <section className={`acp-work-panel ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Agent work">
      <div className="acp-work-header-row">
        <button
          type="button"
          className="acp-work-header"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={`acp-work-dot ${active ? 'is-active' : 'is-done'}`} />
          <span>{active ? 'Working' : 'Work complete'}</span>
          <span className="acp-work-count">{toolCalls.length} tool calls</span>
          <span className="acp-work-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
        <button
          type="button"
          className="acp-work-clear"
          aria-label="Clear conversation"
          title="Clear conversation"
          onClick={onClear}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      {open && toolCalls.length > 0 && !active ? (
        <div className="acp-work-list">
          {toolCalls.map((event) => (
            <div key={event.toolCallId} className="acp-work-item">
              <span className="acp-work-item-name">{event.title || event.name || event.toolCallId}</span>
              <span className="acp-work-item-status">{statusLabel(event.status)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AcpTranscript({ events }: { events: readonly AcpSessionEvent[] }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const displayEvents = useMemo(() => mergeAcpTranscriptChunks(events), [events])
  const railItems = useMemo<NativeChatRailItem[]>(
    () =>
      displayEvents.flatMap((event, index) =>
        event.kind === 'message' && event.role === 'user'
          ? [
              {
                id: `acp-event-${index}`,
                slotIndex: index,
                text: event.text.trim().replaceAll(/\s+/g, ' '),
                hasImages: (event.media?.length ?? 0) > 0
              }
            ]
          : []
      ),
    [displayEvents]
  )
  // Mirrors Native Chat: a rail narrower than this covers the message it points
  // at, and fewer than three ticks is noise the scrollbar already provides. The
  // width gate is what kept the rail off user bubbles in a narrow split pane.
  const railWanted = railItems.length >= NATIVE_CHAT_RAIL_MIN_ITEMS
  const [railFits, setRailFits] = useState(false)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    const measure = (): void => {
      setRailFits(element.clientWidth >= NATIVE_CHAT_RAIL_MIN_WIDTH_PX)
    }
    // Measured once up front, not only inside the observer: a host without
    // ResizeObserver (and the test environment) would otherwise never decide.
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // Sampled to a readable count: an unsampled rail taller than its column
  // overflowed the flex container and its ticks collided with each other.
  const railTicks = useMemo(
    () => selectNativeChatRailTicks({ items: railItems, activeId }),
    [railItems, activeId]
  )

  useEffect(() => {
    const element = scrollRef.current
    if (element && !showJump) {
      element.scrollTop = element.scrollHeight
    }
  }, [events, showJump])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    setShowJump(element.scrollHeight - element.scrollTop - element.clientHeight >= 48)
    const firstVisible = [...element.querySelectorAll<HTMLElement>('[data-acp-event-kind="message"]')]
      .find((row) => row.getBoundingClientRect().bottom > element.getBoundingClientRect().top + 24)
    if (firstVisible?.dataset.acpEventIndex) {
      setActiveId(`acp-event-${firstVisible.dataset.acpEventIndex}`)
    }
  }

  const jumpTo = (id: string): void => {
    const index = Number(id.slice('acp-event-'.length))
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-acp-event-index="${index}"]`)
    target?.scrollIntoView({ block: 'start' })
    setActiveId(id)
    setShowJump(true)
  }

  const jumpToLatest = (): void => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    element.scrollTop = element.scrollHeight
    setShowJump(false)
  }

  return (
    <div className="acp-transcript-shell">
      <div ref={scrollRef} className="acp-transcript" onScroll={onScroll}>
        <div className="acp-events">
          {displayEvents.map((event, index) => {
            const rendered = <AcpEvent key={`${index}-${event.kind}`} event={event} eventIndex={index} />
            return rendered ? <div key={`acp-event-${index}`} id={`acp-event-${index}`}>{rendered}</div> : null
          })}
        </div>
      </div>
      <NativeChatMessageRail
        rail={{
          ticks: railTicks,
          items: railItems,
          activeId,
          visible: railWanted && railFits
        }}
        scrollRef={scrollRef}
        onSelect={(item) => {
          if (item.slotIndex !== null) {
            jumpTo(`acp-event-${item.slotIndex}`)
          }
        }}
      />
      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label={translate('components.native-chat.jumpToLatest', 'Jump to latest')}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown className="size-3.5" />
          <span>{translate('components.native-chat.jumpToLatest', 'Jump to latest')}</span>
        </button>
      ) : null}
    </div>
  )
}

function acpContextUsageLabel(usage: AcpContextUsage | null): string | null {
  if (!usage || usage.size <= 0) {
    return null
  }
  return `${Math.round((usage.used / usage.size) * 100)}% context`
}

export default function AcpSessionPanel({
  sessionId,
  title,
  isVisible = true
}: {
  sessionId: string
  title: string
  isVisible?: boolean
}): React.JSX.Element {
  // Why visibility is UI-only: the session must keep receiving events while the
  // worktree or tab is backgrounded. Gating the hook on isVisible froze the
  // transcript until the panel was focused again.
  const session = useAcpSession(sessionId)
  const composerRef = useRef<NativeChatComposerHandle>(null)
  const status = session.busy ? 'prompting' : session.summary?.status ?? 'starting'
  const failure = session.error ?? session.summary?.error ?? null
  const canSend = status === 'ready' || status === 'prompting'
  const usageLabel = acpContextUsageLabel(session.contextUsage)
  const conversationEvents = useMemo(
    () => session.events.filter(
      (event) => event.kind === 'message' || event.kind === 'thought' || event.kind === 'closed'
    ),
    [session.events]
  )
  const transcriptEvents = useMemo(
    () => selectAcpTranscriptEvents(session.events, status === 'prompting'),
    [session.events, status]
  )

  return (
    <div data-acp-chat-root="true" data-acp-chat-title={title} className="acp-panel">
      {session.plan && session.plan.length > 0 ? <AcpPlanList plan={session.plan} /> : null}
      <AcpWorkPanel
        events={session.events}
        status={status}
        hasConversation={conversationEvents.length > 0}
        onClear={() => void session.clear()}
      />
      {usageLabel ? <div className="acp-usage">{usageLabel}</div> : null}
      <div className="acp-transcript-slot">
        {failure && conversationEvents.length === 0 ? (
          <div className="acp-transcript"><NativeChatEmptyState kind="error" message={failure} /></div>
        ) : status === 'starting' && conversationEvents.length === 0 ? (
          <div className="acp-transcript"><NativeChatEmptyState kind="loading" /></div>
        ) : conversationEvents.length === 0 ? (
          <div className="acp-transcript"><NativeChatEmptyState kind="empty" /></div>
        ) : (
          <AcpTranscript events={transcriptEvents} />
        )}
      </div>
      {session.permission ? (
        <NativeChatApprovalCard
          approval={{
            title: session.permission.title,
            options: [
              ...session.permission.options.map((option) => ({ label: option.name, send: option.optionId })),
              { label: 'Decline', send: '' }
            ]
          }}
          onChoose={(optionId) =>
            void session.respondPermission(
              optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
            )
          }
          shouldFocus={isVisible}
        />
      ) : null}
      <div className="acp-composer-wrap">
        {session.modes && session.modes.availableModes.length > 0 ? (
          <div className="pointer-events-none absolute bottom-full right-3 z-10 mb-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-xs shadow-sm">
            <label htmlFor={`acp-mode-${sessionId}`} className="text-muted-foreground">Mode</label>
            <select
              id={`acp-mode-${sessionId}`}
              value={session.modes.currentModeId}
              disabled={session.busy || status === 'starting'}
              onChange={(event) => void session.setMode(event.target.value)}
              className="pointer-events-auto max-w-32 bg-transparent text-foreground outline-none"
            >
              {session.modes.availableModes.map((mode) => (
                <option key={mode.id} value={mode.id} title={mode.description}>{mode.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <NativeChatComposer
          ref={composerRef}
          terminalTabId={sessionId}
          paneKey={`acp:${sessionId}`}
          targetPtyId={null}
          agent="agent"
          canSend={canSend}
          isWorking={status === 'prompting' || session.busy}
          onStop={() => void session.cancel()}
          structuredTransport={{
            send: (text) => {
              if (!canSend || text.trim().length === 0) {
                return false
              }
              void session.send(text)
              return true
            },
            dispatchCommand: () => Promise.resolve({ handled: false, accepted: false, error: null }),
            optionsSurface: {
              getSnapshot: () => [],
              setOption: () => Promise.resolve({ snapshot: [] }),
              invokeAction: () => Promise.resolve({ snapshot: [] }),
              subscribe: () => () => {}
            },
            optionSnapshot: [],
            contextUsage: session.contextUsage
              ? {
                  usedTokens: Math.max(0, session.contextUsage.used),
                  windowTokens: Math.max(0, session.contextUsage.size),
                  percentage: session.contextUsage.size > 0
                    ? Math.round((session.contextUsage.used / session.contextUsage.size) * 100)
                    : 0,
                  estimated: false,
                  categories: []
                }
              : null,
            ...(session.commands
              ? { sessionCommands: session.commands.map((command) => ({ ...command, kind: 'command' as const })) }
              : {}),
            onError: () => {},
            runtime: 'local',
            sessionId,
            runtimeEnvironmentId: null
          }}
        />
      </div>
    </div>
  )
}
