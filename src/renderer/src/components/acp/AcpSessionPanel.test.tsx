// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import AcpSessionPanel from './AcpSessionPanel'
import type {
  AcpPermissionRequest,
  AcpSessionEventPayload,
  AcpSessionSummary,
  AcpSessionView
} from '../../../../shared/acp-types'

const { api, emitEvent, emitPermission } = vi.hoisted(() => {
  const eventListeners = new Set<(payload: AcpSessionEventPayload) => void>()
  const permissionListeners = new Set<(request: AcpPermissionRequest) => void>()
  return {
    api: {
      prompt: vi.fn(),
      clear: vi.fn(),
      cancel: vi.fn(),
      setMode: vi.fn(),
      view: vi.fn(),
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

Object.assign(window, {
  api: {
    acp: api,
    ui: { onFileDrop: () => () => {} },
    shell: { pickAttachment: async () => null }
  }
})

const SESSION = 'session-1'

function summary(overrides: Partial<AcpSessionSummary> = {}): AcpSessionSummary {
  return { sessionId: SESSION, agentSessionId: 'agent-session-1', title: 'My Agent', status: 'ready', ...overrides }
}

function view(events: AcpSessionView['events'] = [], overrides: Partial<AcpSessionSummary> = {}): AcpSessionView {
  return { summary: summary(overrides), events }
}

function eventPayload(event: AcpSessionEventPayload['event']): AcpSessionEventPayload {
  return { sessionId: SESSION, event }
}

function renderPanel(): void {
  render(<TooltipProvider><AcpSessionPanel sessionId={SESSION} title="My Agent" /></TooltipProvider>)
}

describe('AcpSessionPanel', () => {
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

  afterEach(() => cleanup())

  it('renders ACP message chunks without converting them to native chat messages', async () => {
    api.view.mockResolvedValue(view([
      { kind: 'message', role: 'assistant', messageId: 'm1', text: 'first ' },
      { kind: 'message', role: 'assistant', messageId: 'm1', text: 'part' },
      { kind: 'tool_call', toolCallId: 't1', title: 'Run tests', status: 'completed' }
    ]))
    renderPanel()

    await waitFor(() => expect(screen.getByText('first part')).toBeTruthy())
    expect(document.querySelectorAll('[data-acp-event-kind="message"]')).toHaveLength(1)
    const workPanel = document.querySelector('[aria-label="Agent work"]')
    expect(workPanel).toBeTruthy()
    expect(workPanel?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('provides user-history navigation and jump-to-latest controls', async () => {
    api.view.mockResolvedValue(view([
      { kind: 'message', role: 'user', text: 'first question' },
      { kind: 'message', role: 'assistant', text: 'first answer' },
      { kind: 'message', role: 'user', text: 'second question' },
      { kind: 'message', role: 'assistant', text: 'second answer' },
      { kind: 'message', role: 'user', text: 'third question' },
      { kind: 'message', role: 'assistant', text: 'third answer' }
    ]))
    renderPanel()

    await waitFor(() => expect(screen.getByText('first question')).toBeTruthy())

    const scroll = document.querySelector('.acp-transcript') as HTMLDivElement
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    })
    scroll.dispatchEvent(new Event('scroll'))
    expect(await screen.findByRole('button', { name: 'Jump to latest' })).toBeTruthy()
  })

  it('uses the muted theme surface for user prompts', async () => {
    api.view.mockResolvedValue(view([{ kind: 'message', role: 'user', text: 'theme test' }]))
    renderPanel()

    await waitFor(() => expect(screen.getByText('theme test')).toBeTruthy())
    const bubble = screen.getByText('theme test').closest('.acp-message-user')
    expect(bubble).toBeTruthy()
    expect(bubble?.className).toContain('acp-message-user')
  })

  it('shows loading, error, and empty states without hiding the ACP composer', async () => {
    api.view.mockResolvedValue(view([], { status: 'failed', error: 'spawn my-agent ENOENT' }))
    renderPanel()

    await waitFor(() => expect(screen.getByText('spawn my-agent ENOENT')).toBeTruthy())
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('shows a replay failure instead of staying on the loading state', async () => {
    api.view.mockRejectedValue(new Error('ACP view unavailable'))
    renderPanel()

    await waitFor(() => expect(screen.getByText('ACP view unavailable')).toBeTruthy())
    expect(screen.queryByText('Reading the agent transcript.')).toBeNull()
  })

  it('sends a typed prompt through the composer', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    await user.type(screen.getByRole('textbox'), 'hello agent')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(api.prompt).toHaveBeenCalledWith({ sessionId: SESSION, text: 'hello agent' })
  })

  it('clears the retained conversation without cancelling the agent', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    api.view.mockResolvedValue(view([{ kind: 'message', role: 'assistant', text: 'old transcript' }]))
    renderPanel()

    await waitFor(() => expect(screen.getByText('old transcript')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Clear conversation' }))

    expect(api.clear).toHaveBeenCalledWith({ sessionId: SESSION })
    await waitFor(() => expect(screen.queryByText('old transcript')).toBeNull())
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('renders and answers a permission request', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(api.view).toHaveBeenCalled())

    emitPermission({
      requestId: 'req-1', sessionId: SESSION, title: 'Run the tests', options: [{ optionId: 'allow', name: 'Allow' }]
    })
    await waitFor(() => expect(screen.getByText('Run the tests')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Allow' }))

    expect(api.respondPermission).toHaveBeenCalledWith({
      requestId: 'req-1', decision: { outcome: 'selected', optionId: 'allow' }
    })
  })

  it('renders a live ACP event with its original fields', async () => {
    renderPanel()
    await waitFor(() => expect(api.view).toHaveBeenCalled())
    emitEvent(eventPayload({ kind: 'message', role: 'assistant', messageId: 'live-1', text: 'streamed live' }))

    await waitFor(() => expect(screen.getByText('streamed live')).toBeTruthy())
    expect(document.querySelector('[data-acp-event-kind="message"]')).toBeTruthy()
  })

  it('uses the ACP panel stylesheet hook', async () => {
    renderPanel()
    expect(document.querySelector('[data-acp-chat-root="true"]')?.className).toBe('acp-panel')
  })

  it('shows Stop only while a turn is running', async () => {
    api.view.mockResolvedValue(view([{ kind: 'turn_start', text: 'work' }], { status: 'prompting' }))
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Stop the agent' })).toBeTruthy()
  })

  it('merges thought chunks and shows active tool calls below the conversation', async () => {
    api.view.mockResolvedValue(view([
      { kind: 'turn_start', text: 'work' },
      { kind: 'message', role: 'user', text: 'inspect the project' },
      { kind: 'thought', messageId: 'thought-1', text: 'first thought ' },
      { kind: 'thought', messageId: 'thought-1', text: 'second thought' },
      { kind: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', status: 'in_progress', input: { command: 'pnpm test' } },
      { kind: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', status: 'completed', output: '3 tests passed', content: [{ type: 'text', text: '3 tests passed' }] }
    ], { status: 'prompting' }))
    renderPanel()

    await waitFor(() => expect(screen.getByText('inspect the project')).toBeTruthy())
    expect(document.querySelectorAll('[data-acp-event-kind="thought"]')).toHaveLength(1)
    expect(document.querySelector('.acp-thought-body')?.textContent).toBe('first thought second thought')
    expect(document.querySelectorAll('[data-acp-event-kind="tool_call"]')).toHaveLength(1)
    const toolCall = document.querySelector('.acp-tool-call') as HTMLDetailsElement
    expect(toolCall.closest('.acp-transcript')).toBeTruthy()
    const { default: userEvent } = await import('@testing-library/user-event')
    await userEvent.setup().click(toolCall.querySelector('summary') as HTMLElement)
    expect(screen.getByText('Input')).toBeTruthy()
    expect(document.querySelectorAll('.acp-tool-call-value pre')[0]?.textContent).toBe(
      JSON.stringify({ command: 'pnpm test' }, null, 2)
    )
    expect(screen.getByText('Output')).toBeTruthy()
    expect(document.querySelectorAll('.acp-tool-call-value pre')[1]?.textContent).toBe('3 tests passed')
    expect(screen.getByText('Content')).toBeTruthy()
    expect(document.querySelectorAll('.acp-tool-call-value pre')[2]?.textContent).toContain('3 tests passed')
    expect(document.querySelector('.acp-work-list')).toBeNull()
    expect(screen.getByText('1 tool calls')).toBeTruthy()
  })

  it('keeps completed tool calls in the top history summary', async () => {
    api.view.mockResolvedValue(view([
      { kind: 'turn_start', text: 'work' },
      { kind: 'message', role: 'user', text: 'inspect the project' },
      { kind: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', status: 'completed' },
      { kind: 'turn_end', stopReason: 'end_turn' }
    ]))
    renderPanel()

    await waitFor(() => expect(screen.getByText('inspect the project')).toBeTruthy())
    expect(document.querySelectorAll('[data-acp-event-kind="tool_call"]')).toHaveLength(0)
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Work complete/ }))
    expect(document.querySelector('.acp-work-list')).toBeTruthy()
    expect(screen.getByText('Work complete')).toBeTruthy()
  })
})
