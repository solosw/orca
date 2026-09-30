import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConnectionManagerMock } = vi.hoisted(() => ({
  getConnectionManagerMock: vi.fn()
}))

// Why mocked: a remote transport needs a live SSH connection, which only the
// real app has. The stub stands for the channel sshd would give us.
vi.mock('../ipc/ssh', () => ({
  getSshConnectionManager: getConnectionManagerMock
}))

import {
  buildLocalWindowsAcpCommandLine,
  buildLocalWindowsAcpSpawnArgs,
  buildRemoteAcpCommand,
  startAcpTransport
} from './acp-transport'

const FIXTURE = join(__dirname, '__fixtures__', 'scripted-acp-agent.mjs')

/** Reads whole lines off the transport, so a test can assert on protocol frames. */
function lineReader(stream: ReadableStream<Uint8Array>): {
  next: () => Promise<unknown>
  close: () => Promise<void>
} {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const queue: string[] = []

  return {
    async next() {
      for (;;) {
        while (queue.length > 0) {
          return JSON.parse(queue.shift()!)
        }
        const { value, done } = await reader.read()
        if (done) {
          throw new Error('transport closed before a full line arrived')
        }
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line) {
            queue.push(line)
          }
          index = buffer.indexOf('\n')
        }
      }
    },
    async close() {
      await reader.cancel().catch(() => {})
    }
  }
}

function writeFrame(stream: WritableStream<Uint8Array>, message: unknown): Promise<void> {
  const writer = stream.getWriter()
  return writer
    .write(new TextEncoder().encode(`${JSON.stringify(message)}\n`))
    .then(() => writer.releaseLock())
}

/**
 * Reads a JSON-RPC frame's own fields without asserting away its type.
 *
 * `in` narrowing gives the test typed access without an `as` cast, which the
 * repo's code-quality gate rejects.
 */
function frameField(frame: unknown, key: string): unknown {
  if (typeof frame !== 'object' || frame === null || !(key in frame)) {
    throw new Error(`frame has no "${key}" field`)
  }
  return frame[key]
}

describe('startAcpTransport', () => {
  it('rejects an empty command rather than spawning nothing', () => {
    // Why the await: the factory returns a transport synchronously for a local
    // launch and a promise for a remote one, so callers always await it.
    expect(() => startAcpTransport({ command: '   ' })).toThrow(/command is empty/i)
  })

  it('pipes a JSON-RPC request through to the agent and reads the reply', async () => {
    const transport = await startAcpTransport({
      command: process.execPath,
      args: [FIXTURE, 'echo']
    })
    const reader = lineReader(transport.readable)
    try {
      await writeFrame(transport.writable, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: 1 }
      })
      const reply = await reader.next()
      expect(frameField(reply, 'id')).toBe(1)
      const result = frameField(reply, 'result')
      expect(frameField(result, 'protocolVersion')).toBe(1)
    } finally {
      await reader.close()
      await transport.close()
    }
  })

  it('preserves framing across chunk boundaries by sending newline-delimited frames', async () => {
    const transport = await startAcpTransport({
      command: process.execPath,
      args: [FIXTURE, 'echo']
    })
    const reader = lineReader(transport.readable)
    try {
      // Two requests written back to back in ONE write must arrive as two
      // frames; a transport that re-chunked by write() would merge them.
      const writer = transport.writable.getWriter()
      await writer.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n` +
            `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: {} })}\n`
        )
      )
      writer.releaseLock()

      const first = await reader.next()
      const second = await reader.next()
      expect([frameField(first, 'id'), frameField(second, 'id')]).toEqual([1, 2])
    } finally {
      await reader.close()
      await transport.close()
    }
  })

  it('resolves closed with the exit code when the agent dies', async () => {
    const transport = await startAcpTransport({
      command: process.execPath,
      args: [FIXTURE, 'crash']
    })
    const { code } = await transport.closed
    expect(code).toBe(3)
  })

  it('captures the stderr tail so a startup failure is diagnosable', async () => {
    const transport = await startAcpTransport({
      command: process.execPath,
      args: [FIXTURE, 'crash']
    })
    await transport.closed
    // The write happens before exit, but the stream callback may land after
    // 'close'; poll briefly rather than assume ordering.
    for (let attempt = 0; attempt < 20 && !transport.stderrTail(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(transport.stderrTail()).toContain('refusing to start')
  })

  it('close() is idempotent and terminates the agent', async () => {
    const transport = await startAcpTransport({
      command: process.execPath,
      args: [FIXTURE, 'silence']
    })
    await transport.close()
    await transport.close()
    const { code, signal } = await transport.closed
    // Either an exit code or a kill signal is acceptable; the point is it ended.
    expect(code !== null || signal !== null).toBe(true)
  })
})

describe('buildLocalWindowsAcpCommandLine', () => {
  it('enters the workspace before starting the agent', () => {
    const command = buildLocalWindowsAcpCommandLine(
      { command: 'solcode.cmd', args: ['--acp'] },
      'C:\\software\\projects\\orca'
    )
    expect(command).toBe(
      'cd /d "C:\\software\\projects\\orca" && "solcode.cmd" "--acp"'
    )
  })

  it('neutralises cmd metacharacters in the workspace path', () => {
    const command = buildLocalWindowsAcpCommandLine(
      { command: 'agent.cmd' },
      'C:\\work\\a&b'
    )
    expect(command.startsWith('cd /d ')).toBe(true)
    expect(command).toContain('"C:\\work\\a&b"')
    expect(command.endsWith(' && "agent.cmd"')).toBe(true)
  })

  it('hands cmd /c the whole cd-and-run line instead of one verbatim argument', () => {
    expect(
      buildLocalWindowsAcpSpawnArgs(
        { command: 'solcode', args: ['--acp'] },
        'C:\\software\\projects\\orca'
      )
    ).toEqual([
      '/d',
      '/v:off',
      '/s',
      '/c',
      'cd /d "C:\\software\\projects\\orca" && "solcode" "--acp"'
    ])
  })
})

describe('buildRemoteAcpCommand', () => {
  it('changes directory and starts the agent in one shell line', () => {
    const command = buildRemoteAcpCommand({ command: 'my-agent', args: ['--acp'] }, '/srv/app')
    expect(command).toBe("cd '/srv/app' && 'my-agent' '--acp'")
  })

  it('sets environment entries inline, before the command', () => {
    // Why inline: an SSH exec channel is a non-login shell, so the user's
    // profile is not sourced — `env` is the only way to configure the launch.
    const command = buildRemoteAcpCommand(
      { command: 'agent', env: { TOKEN: 'a b', PATH: '/opt/bin:$PATH' } },
      '/srv/app'
    )
    expect(command).toBe("cd '/srv/app' && TOKEN='a b' PATH='/opt/bin:$PATH' 'agent'")
  })

  it('drops env names that are not valid POSIX identifiers', () => {
    // Why drop rather than quote: `1BAD=x` is a syntax error in sh, which would
    // fail the whole launch instead of just ignoring one entry.
    const command = buildRemoteAcpCommand(
      { command: 'agent', env: { '1BAD': 'x', 'BAD-NAME': 'y', GOOD_NAME: 'z' } },
      undefined
    )
    expect(command).toBe("GOOD_NAME='z' 'agent'")
  })

  it('escapes single quotes so a crafted argument cannot break out', () => {
    const command = buildRemoteAcpCommand({ command: 'agent', args: ["it's; rm -rf /"] }, '/srv')
    // The quote closes and reopens; nothing reaches the shell unquoted.
    expect(command).toBe("cd '/srv' && 'agent' 'it'\\''s; rm -rf /'")
  })

  it('omits the cd when the caller gives no working directory', () => {
    expect(buildRemoteAcpCommand({ command: 'agent' }, undefined)).toBe("'agent'")
  })
})

describe('startAcpTransport over SSH', () => {
  /** A channel double with the duplex surface the transport consumes. */
  function createChannelStub(): EventEmitter & {
    stderr: EventEmitter
    end: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
  } {
    const channel = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      end: vi.fn(),
      close: vi.fn(),
      write: vi.fn()
    })
    return channel
  }

  beforeEach(() => {
    getConnectionManagerMock.mockReset()
  })

  it('refuses to start when the host is not connected', async () => {
    getConnectionManagerMock.mockReturnValue({ getConnection: () => undefined })
    await expect(
      startAcpTransport({ command: 'agent' }, { connectionId: 'ssh-1', cwd: '/srv' })
    ).rejects.toThrow(/not connected/i)
  })

  it('refuses to start when the connection exists but is not in the connected state', async () => {
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({ getState: () => ({ status: 'connecting' }) })
    })
    await expect(
      startAcpTransport({ command: 'agent' }, { connectionId: 'ssh-1' })
    ).rejects.toThrow(/not connected/i)
  })

  it('opens one exec channel carrying the cd-and-run line', async () => {
    const channel = createChannelStub()
    const exec = vi.fn().mockResolvedValue(channel)
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({ getState: () => ({ status: 'connected' }), exec })
    })

    const transport = await startAcpTransport(
      { command: 'my-agent', args: ['--acp'] },
      { connectionId: 'ssh-1', cwd: '/srv/app' }
    )
    try {
      expect(exec).toHaveBeenCalledTimes(1)
      // Why the default wrapper: it runs the line under /bin/sh and keeps
      // stdin open, which is what lets the ACP client keep talking.
      expect(exec.mock.calls[0][0]).toBe("cd '/srv/app' && 'my-agent' '--acp'")
    } finally {
      await transport.close()
    }
  })

  it('surfaces a dropped SSH transport as a closed session', async () => {
    const channel = createChannelStub()
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({
        getState: () => ({ status: 'connected' }),
        exec: vi.fn().mockResolvedValue(channel)
      })
    })

    const transport = await startAcpTransport({ command: 'agent' }, { connectionId: 'ssh-1' })
    // A transport error is not an exit; it must still settle `closed`, or the
    // session would sit in a live state forever after the host went away.
    channel.emit('error', new Error('connection reset'))
    await expect(transport.closed).resolves.toEqual({ code: null, signal: null })
  })

  it('ends stdin first, then closes the channel when the agent will not exit', async () => {
    const channel = createChannelStub()
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({
        getState: () => ({ status: 'connected' }),
        exec: vi.fn().mockResolvedValue(channel)
      })
    })

    const transport = await startAcpTransport({ command: 'agent' }, { connectionId: 'ssh-1' })
    await transport.close()

    // Why both: EOF is the agent's cue to flush and exit on its own; closing the
    // channel is the bounded fallback for one that ignores it.
    expect(channel.end).toHaveBeenCalled()
    expect(channel.close).toHaveBeenCalled()
  })

  it('does not force-close a channel that exits on EOF within the grace', async () => {
    const channel = createChannelStub()
    getConnectionManagerMock.mockReturnValue({
      getConnection: () => ({
        getState: () => ({ status: 'connected' }),
        exec: vi.fn().mockResolvedValue(channel)
      })
    })

    const transport = await startAcpTransport({ command: 'agent' }, { connectionId: 'ssh-1' })
    // The agent reacts to EOF immediately, as a well-behaved ACP agent does.
    channel.end.mockImplementation(() => channel.emit('close', 0))
    await transport.close()

    expect(channel.close).not.toHaveBeenCalled()
    await expect(transport.closed).resolves.toEqual({ code: 0, signal: null })
  })
})