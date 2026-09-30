// @vitest-environment happy-dom
import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAcpSession } from './use-acp-session'
import type {
  AcpPermissionRequest,
  AcpSessionEventPayload,
  AcpSessionSummary,
  AcpSessionView
} from '../../../../shared/acp-types'

const { api, emitEvent, emitPermission } = vi.hoisted(() => {
  const eventListeners = new Set<(payload: AcpSessionEventPayload) => void>()
  const permissionListeners = new Set<(payload: AcpPermissionRequest) => void>()
  return {
    api: {
      prompt: vi.fn(),
      clear: vi.fn(),
      cancel: vi.fn(),
      view: vi.fn(),
      setMode: vi.fn(),
      respondPermission: vi.fn(),
      onEvent: vi.fn((listener: (payload: AcpSessionEventPayload) => void) => {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      }),
      onPermissionRequest: vi.fn((listener: (request: AcpPermissionRequest) => void) => {
        permissionListeners.add(listener)
        return () => permissionListeners.delete(listener)
      })
    },
    emitEvent: (payload: AcpSessionEventPayload) => {
      for (const listener of eventListeners) {
        listener(payload)
      }
    },
    emitPermission: (request: AcpPermissionRequest) => {
      for (const listener of permissionListeners) {
        listener(request)
      }
    }
  }
})

Object.assign(window, { api: { acp: api } })

const SESSION = 'session-1'

function summary(overrides: Partial<AcpSessionSummary> = {}): AcpSessionSummary {
  return {
    sessionId: SESSION,
    agentSessionId: 'agent-session-1',
    title: 'My Agent',
    status: 'ready',
    ...overrides
  }
}

function eventPayload(event: AcpSessionEventPayload['event']): AcpSessionEventPayload {
  return { sessionId: SESSION, event }
}

function view(events: AcpSessionView['events'] = [], overrides: Partial<AcpSessionSummary> = {}): AcpSessionView {
  return { summary: summary(overrides), events }
}

describe('useAcpSession', () => {
  beforeEach(() => {
    api.prompt.mockReset().mockResolvedValue(summary())
    api.clear.mockReset().mockResolvedValue(undefined)
    api.cancel.mockReset().mockResolvedValue(undefined)
    api.setMode.mockReset().mockResolvedValue(undefined)
    api.view.mockReset().mockResolvedValue(view())
    api.respondPermission.mockReset().mockResolvedValue(undefined)
    api.onEvent.mockClear()
    api.onPermissionRequest.mockClear()
  })

  it('replays ACP events without converting or merging them', async () => {
    const events: AcpSessionView['events'] = [
      { kind: 'turn_start', text: 'fix it' },
      { kind: 'message', role: 'assistant', messageId: 'message-a', text: 'first ' },
      { kind: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', status: 'in_progress' },
      { kind: 'message', role: 'assistant', messageId: 'message-a', text: 'part' },
      { kind: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', status: 'completed' },
      { kind: 'turn_end', stopReason: 'end_turn' }
    ]
    api.view.mockResolvedValue(view(events))
    const { result } = renderHook(() => useAcpSession(SESSION))

    await waitFor(() => expect(result.current.events).toEqual(events))
    expect(result.current.events[1]).toEqual(events[1])
    expect(result.current.events[3]).toEqual(events[3])
    expect(result.current.events[2]).toEqual(events[2])
    expect(result.current.events[4]).toEqual(events[4])
  })

  it('keeps polling a starting session until it becomes ready', async () => {
    api.view
      .mockResolvedValueOnce(view([], { status: 'starting' }))
      .mockResolvedValueOnce(view([{ kind: 'message', role: 'assistant', text: 'ready transcript' }]))
    const { result } = renderHook(() => useAcpSession(SESSION))

    await waitFor(() => expect(result.current.events).toEqual([
      { kind: 'message', role: 'assistant', text: 'ready transcript' }
    ]), { timeout: 2_000 })
    expect(api.view).toHaveBeenCalledTimes(2)
  })

  it('retries a view that is temporarily unavailable during tab creation', async () => {
    api.view
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(view([{ kind: 'message', role: 'assistant', text: 'ready now' }]))
    const { result } = renderHook(() => useAcpSession(SESSION))

    await waitFor(() => expect(result.current.events).toEqual([
      { kind: 'message', role: 'assistant', text: 'ready now' }
    ]), { timeout: 2_000 })
    expect(api.view).toHaveBeenCalledTimes(2)
  })

  it('appends live events for its own session only', async () => {
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    act(() => {
      emitEvent(eventPayload({ kind: 'message', role: 'assistant', text: 'mine' }))
      emitEvent({ sessionId: 'other', event: { kind: 'message', role: 'assistant', text: 'theirs' } })
    })

    await waitFor(() => expect(result.current.events).toEqual([{ kind: 'message', role: 'assistant', text: 'mine' }]))
  })

  it('keeps appending live events after the initial replay settles', async () => {
    api.view.mockResolvedValue(
      view([{ kind: 'message', role: 'assistant', text: 'history' }])
    )
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() =>
      expect(result.current.events).toEqual([{ kind: 'message', role: 'assistant', text: 'history' }])
    )

    // Why: switching worktree used to disable the hook and drop this stream.
    // The panel stays mounted; the subscription must keep working in the background.
    act(() => {
      emitEvent(eventPayload({ kind: 'message', role: 'assistant', text: 'background chunk' }))
      emitEvent(eventPayload({ kind: 'turn_end', stopReason: 'end_turn' }))
    })

    await waitFor(() =>
      expect(result.current.events).toEqual([
        { kind: 'message', role: 'assistant', text: 'history' },
        { kind: 'message', role: 'assistant', text: 'background chunk' },
        { kind: 'turn_end', stopReason: 'end_turn' }
      ])
    )
    expect(result.current.busy).toBe(false)
    expect(result.current.summary?.status).toBe('ready')
  })

  it('marks the session busy from turn_start even without a local send', async () => {
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    act(() => {
      emitEvent(eventPayload({ kind: 'turn_start', text: 'keep going' }))
    })

    await waitFor(() => {
      expect(result.current.busy).toBe(true)
      expect(result.current.summary?.status).toBe('prompting')
    })
  })

  it('keeps metadata in panel state while retaining the original event', async () => {
    const metadata: AcpSessionEventPayload['event'][] = [
      { kind: 'usage', used: 10, size: 100 },
      { kind: 'mode', currentModeId: 'code' },
      { kind: 'plan', entries: [{ content: 'step one', status: 'in_progress' }] },
      { kind: 'commands', commands: [{ name: 'test', description: 'Run tests' }] }
    ]
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    act(() => {
      for (const event of metadata) {
        emitEvent(eventPayload(event))
      }
    })

    await waitFor(() => expect(result.current.events).toEqual(metadata))
    expect(result.current.contextUsage).toEqual({ used: 10, size: 100 })
    const planEvent = metadata.find((event) => event.kind === 'plan')
    const commandsEvent = metadata.find((event) => event.kind === 'commands')
    expect(result.current.plan).toEqual(planEvent?.kind === 'plan' ? planEvent.entries : null)
    expect(result.current.commands).toEqual(commandsEvent?.kind === 'commands' ? commandsEvent.commands : undefined)
  })

  it('does not fabricate a local message before ACP reports it', async () => {
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    await act(async () => {
      await result.current.send('run the tests')
    })

    expect(api.prompt).toHaveBeenCalledWith({ sessionId: SESSION, text: 'run the tests' })
    // The main process owns the persisted user event; the hook only renders events it receives.
    expect(result.current.events).toEqual([])
  })

  it('preserves a live event that arrives while replay is reading the view', async () => {
    let resolveView!: (value: AcpSessionView) => void
    api.view.mockReturnValue(new Promise<AcpSessionView>((resolve) => { resolveView = resolve }))
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    act(() => emitEvent(eventPayload({ kind: 'message', role: 'assistant', text: 'live' })))
    await act(async () => {
      resolveView(view([{ kind: 'message', role: 'assistant', text: 'history' }]))
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.events).toEqual([
      { kind: 'message', role: 'assistant', text: 'history' },
      { kind: 'message', role: 'assistant', text: 'live' }
    ]))
  })

  it('answers permission requests once and ignores another session', async () => {
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())
    const request = { requestId: 'req-1', sessionId: SESSION, title: 'Run tests', options: [{ optionId: 'allow', name: 'Allow' }] }

    act(() => {
      emitPermission({ ...request, sessionId: 'other' })
      emitPermission(request)
    })
    await waitFor(() => expect(result.current.permission).toEqual(request))

    await act(async () => {
      await result.current.respondPermission({ outcome: 'selected', optionId: 'allow' })
    })
    expect(api.respondPermission).toHaveBeenCalledWith({ requestId: 'req-1', decision: { outcome: 'selected', optionId: 'allow' } })
    expect(result.current.permission).toBeNull()
  })

  it('retains all events and clears them only on request', async () => {
    const { result } = renderHook(() => useAcpSession(SESSION))
    await waitFor(() => expect(api.view).toHaveBeenCalled())
    act(() => {
      emitEvent(eventPayload({ kind: 'message', role: 'assistant', text: 'old message' }))
    })
    await waitFor(() => expect(result.current.events).toHaveLength(1))

    await act(async () => {
      await result.current.clear()
    })
    expect(api.clear).toHaveBeenCalledWith({ sessionId: SESSION })
    expect(result.current.events).toEqual([])
  })
})
