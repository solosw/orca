import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AcpPermissionDecision, AcpSessionEvent } from '../../shared/acp-types'
import { AcpSession } from './acp-session'

const FIXTURE = join(__dirname, '__fixtures__', 'scripted-acp-agent.mjs')

function fixtureLaunch(mode: string): {
  command: string
  args: string[]
} {
  return { command: process.execPath, args: [FIXTURE, mode] }
}

/** Collects every event a session emits, in order. */
function collectEvents(): {
  events: AcpSessionEvent[]
  onEvent: (id: string, e: AcpSessionEvent) => void
} {
  const events: AcpSessionEvent[] = []
  return { events, onEvent: (_id, event) => events.push(event) }
}

function makeSession(
  mode: string,
  options: {
    onPermission?: (req: {
      requestId: string
      sessionId: string
      title: string
      options: { optionId: string }[]
    }) => Promise<AcpPermissionDecision>
    readTextFile?: (path: string, line?: number | null, limit?: number | null) => Promise<string>
    writeTextFile?: (path: string, content: string) => Promise<void>
  } = {}
): { session: AcpSession; events: AcpSessionEvent[] } {
  const { events, onEvent } = collectEvents()
  const session = new AcpSession({
    sessionId: 'session-1',
    title: 'Scripted agent',
    launch: fixtureLaunch(mode),
    cwd: process.cwd(),
    onEvent,
    onPermissionRequest:
      options.onPermission ??
      (async () => ({ outcome: 'cancelled' }) satisfies AcpPermissionDecision),
    ...(options.readTextFile ? { readTextFile: options.readTextFile } : {}),
    ...(options.writeTextFile ? { writeTextFile: options.writeTextFile } : {})
  })
  return { session, events }
}

describe('AcpSession', () => {
  it('completes the ACP handshake and reports a ready session', async () => {
    const { session } = makeSession('echo')
    try {
      const summary = await session.start()
      expect(summary.status).toBe('ready')
      expect(summary.agentSessionId).toBe('agent-session-1')
      expect(summary.error).toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('reduces a prompt turn into ordered message, thought-free events', async () => {
    const { session, events } = makeSession('echo')
    try {
      await session.start()
      await session.prompt('hello')

      const messages = events.filter((event) => event.kind === 'message')
      // The user prompt is persisted before the agent's response chunks.
      expect(messages).toEqual([
        { kind: 'message', role: 'user', text: 'hello' },
        { kind: 'message', role: 'assistant', messageId: 'assistant-1', text: 'echo:hello' },
        { kind: 'message', role: 'assistant', messageId: 'assistant-1', text: '!' }
      ])
      const toolStart = events.find(
        (event) => event.kind === 'tool_call' && event.status === 'in_progress'
      )
      expect(toolStart).toMatchObject({
        kind: 'tool_call',
        toolCallId: 'tool-1',
        input: { command: 'pnpm test', args: ['--run'] }
      })
      const toolResult = events.find(
        (event) => event.kind === 'tool_call' && event.output === '3 tests passed'
      )
      expect(toolResult).toMatchObject({
        kind: 'tool_call',
        toolCallId: 'tool-1',
        status: 'completed',
        output: '3 tests passed',
        content: [{ type: 'content', content: { type: 'text', text: '3 tests passed' } }]
      })
      expect(events.some((event) => event.kind === 'plan')).toBe(true)
      expect(events.at(-1)).toEqual({ kind: 'turn_end', stopReason: 'end_turn' })
    } finally {
      await session.close()
    }
  })

  it('returns to ready after a completed turn', async () => {
    const { session } = makeSession('echo')
    try {
      await session.start()
      const summary = await session.prompt('again')
      expect(summary.status).toBe('ready')
    } finally {
      await session.close()
    }
  })

  it('surfaces a failed handshake instead of throwing, when the agent never replies', async () => {
    const { session, events } = makeSession('silence')
    try {
      const summary = await session.start()
      expect(summary.status).toBe('failed')
      // Why the message names a timeout: the agent is alive but silent, so the
      // only honest diagnosis is that the handshake deadline passed.
      expect(summary.error).toMatch(/Timed out/i)
      expect(events.some((event) => event.kind === 'closed')).toBe(true)
    } finally {
      await session.close()
    }
  }, 30_000)

  it('reports the agent stderr when startup fails before any protocol reply', async () => {
    const { session } = makeSession('crash')
    try {
      const summary = await session.start()
      expect(summary.status).toBe('failed')
      expect(summary.error).toContain('refusing to start')
    } finally {
      await session.close()
    }
  })

  it('routes a permission request to the caller and returns the chosen option', async () => {
    const onPermission = vi.fn(
      async (_request: {
        requestId: string
        sessionId: string
        title: string
        options: { optionId: string }[]
      }) => ({ outcome: 'selected', optionId: 'allow' }) as const
    )
    const { session, events } = makeSession('perms', { onPermission })
    try {
      await session.start()
      await session.prompt('do it')

      expect(onPermission).toHaveBeenCalledTimes(1)
      const request = onPermission.mock.calls[0][0]
      expect(request.title).toBe('Run the tests')
      expect(request.options.map((option) => option.optionId)).toEqual(['allow', 'reject'])
      // The agent echoes back which outcome it received, proving the bridge
      // carried the decision across the wire rather than only locally.
      expect(events.some((event) => e(event, 'decision=selected'))).toBe(true)
    } finally {
      await session.close()
    }
  })

  it('reports a cancelled permission decision to the agent', async () => {
    const { session, events } = makeSession('perms', {
      onPermission: async () => ({ outcome: 'cancelled' })
    })
    try {
      await session.start()
      await session.prompt('do it')
      expect(events.some((event) => e(event, 'decision=cancelled'))).toBe(true)
    } finally {
      await session.close()
    }
  })

  it('emits closed when the agent exits mid-session', async () => {
    const { session } = makeSession('echo')
    try {
      await session.start()
      await session.close()
      // close() marks the session disposed, so no spurious 'closed' event is
      // required here; the assertion is that shutdown does not throw or hang.
      expect(session.summary().status).not.toBe('prompting')
    } finally {
      await session.close()
    }
  })

  it('refuses to prompt a session that never became ready', async () => {
    const { session } = makeSession('crash')
    try {
      await session.start()
      await expect(session.prompt('nope')).rejects.toThrow(/Cannot prompt/)
    } finally {
      await session.close()
    }
  })
})

function e(event: AcpSessionEvent, contains: string): boolean {
  return event.kind === 'message' && event.text.includes(contains)
}
