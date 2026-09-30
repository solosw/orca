// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AcpSessionEventPayload,
  AcpSessionSummary,
  AcpSessionView
} from '../../../../shared/acp-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { Tab } from '../../../../shared/tab-types'
import { isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import type { AppState } from '@/store/types'
import { AcpSessionStatusBridge } from './AcpSessionStatusBridge'

const mocks = vi.hoisted(() => ({
  removeAgentStatus: vi.fn(),
  setAgentStatus: vi.fn(),
  store: null as null | {
    getState: () => AppState
    setState: (state: Partial<AppState>) => void
  }
}))

const { api, emitEvent } = vi.hoisted(() => {
  const eventListeners = new Set<(payload: AcpSessionEventPayload) => void>()
  return {
    api: {
      view: vi.fn(),
      onEvent: vi.fn((listener: (payload: AcpSessionEventPayload) => void) => {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      })
    },
    emitEvent: (payload: AcpSessionEventPayload) => {
      for (const listener of eventListeners) {
        listener(payload)
      }
    }
  }
})

vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/slices/store-test-helpers')
  const useAppStore = createTestStore()
  const { setAgentStatus, removeAgentStatus } = useAppStore.getState()
  useAppStore.setState({
    setAgentStatus: (...args) => {
      mocks.setAgentStatus(...args)
      setAgentStatus(...args)
    },
    removeAgentStatus: (paneKey) => {
      mocks.removeAgentStatus(paneKey)
      removeAgentStatus(paneKey)
    }
  })
  mocks.store = useAppStore
  return { useAppStore }
})

Object.assign(window, { api: { acp: api } })

const SESSION = 'acp-session-1'

const acpTab = {
  id: 'acp-tab-1',
  worktreeId: 'wt-1',
  groupId: 'group-1',
  contentType: 'acp-session',
  entityId: SESSION,
  label: 'Custom Agent',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0,
  isPinned: false
} satisfies Tab

function summary(overrides: Partial<AcpSessionSummary> = {}): AcpSessionSummary {
  return {
    sessionId: SESSION,
    agentSessionId: 'agent-session-1',
    title: 'Custom Agent',
    status: 'ready',
    ...overrides
  }
}

function view(
  events: AcpSessionView['events'] = [],
  overrides: Partial<AcpSessionSummary> = {}
): AcpSessionView {
  return { summary: summary(overrides), events }
}

function statuses(): AgentStatusEntry[] {
  return Object.values(mocks.store?.getState().agentStatusByPaneKey ?? {})
}

describe('AcpSessionStatusBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.view.mockReset().mockResolvedValue(view())
    api.onEvent.mockClear()
    mocks.store?.setState({
      agentStatusByPaneKey: {},
      unifiedTabsByWorktree: { 'wt-1': [acpTab] }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('seeds a ready ACP session as a settled agent-status row', async () => {
    render(<AcpSessionStatusBridge />)

    await waitFor(() => expect(statuses()).toHaveLength(1))
    expect(statuses()[0]).toEqual(
      expect.objectContaining({
        state: 'done',
        prompt: '',
        agentType: 'agent',
        tabId: acpTab.id,
        worktreeId: 'wt-1',
        terminalTitle: 'Custom Agent',
        terminalResumeEligible: false
      })
    )
    expect(statuses()[0]).not.toHaveProperty('structuredHostOwned')
  })

  it('keeps a working ACP turn fresh past the 30-minute status TTL', async () => {
    api.view.mockResolvedValue(view([], { status: 'prompting' }))
    render(<AcpSessionStatusBridge />)

    await waitFor(() =>
      expect(statuses()[0]).toEqual(
        expect.objectContaining({ state: 'working', structuredHostOwned: true })
      )
    )

    const entry = statuses()[0]
    expect(isExplicitAgentStatusFresh(entry, Date.now() + 30 * 60 * 1000 + 1, 30 * 60 * 1000)).toBe(
      true
    )
  })

  it('publishes turn boundaries and clears host ownership when the turn ends', async () => {
    render(<AcpSessionStatusBridge />)
    await waitFor(() => expect(statuses()).toHaveLength(1))

    act(() =>
      emitEvent({
        sessionId: SESSION,
        event: { kind: 'turn_start', text: 'keep going' }
      })
    )
    expect(statuses()[0]).toEqual(
      expect.objectContaining({
        state: 'working',
        prompt: 'keep going',
        structuredHostOwned: true
      })
    )

    act(() =>
      emitEvent({
        sessionId: SESSION,
        event: { kind: 'message', role: 'assistant', messageId: 'm1', text: 'still working' }
      })
    )
    expect(statuses()[0]).toEqual(
      expect.objectContaining({
        state: 'working',
        prompt: 'keep going',
        structuredHostOwned: true
      })
    )

    act(() =>
      emitEvent({
        sessionId: SESSION,
        event: { kind: 'turn_end', stopReason: 'end_turn' }
      })
    )
    expect(statuses()[0]).toEqual(
      expect.objectContaining({
        state: 'done',
        prompt: 'keep going',
        terminalResumeEligible: false
      })
    )
    expect(statuses()[0]).not.toHaveProperty('structuredHostOwned')
  })

  it('removes the projected row when the ACP tab unmounts', async () => {
    const { unmount } = render(<AcpSessionStatusBridge />)
    await waitFor(() => expect(statuses()).toHaveLength(1))

    unmount()
    expect(mocks.removeAgentStatus).toHaveBeenCalled()
    expect(statuses()).toHaveLength(0)
  })
})
