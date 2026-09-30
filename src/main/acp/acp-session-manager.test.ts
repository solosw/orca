import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AcpSessionEvent } from '../../shared/acp-types'
import { AcpSessionManager } from './acp-session-manager'

const FIXTURE = join(__dirname, '__fixtures__', 'scripted-acp-agent.mjs')

function launch(mode: string): { command: string; args: string[] } {
  return { command: process.execPath, args: [FIXTURE, mode] }
}

function managerArgs(mode: string, sessionId = 'session-1') {
  return {
    sessionId,
    title: 'Scripted agent',
    launch: launch(mode),
    cwd: process.cwd(),
    onPermissionRequest: async () => ({ outcome: 'cancelled' }) as const
  }
}

describe('AcpSessionManager', () => {
  it('starts a session and exposes it through list()', async () => {
    const manager = new AcpSessionManager()
    try {
      const summary = await manager.create(managerArgs('echo'))
      expect(summary.status).toBe('ready')
      expect(manager.list().map((entry) => entry.sessionId)).toEqual(['session-1'])
    } finally {
      await manager.closeAll()
    }
  })

  it('rejects a duplicate session id instead of silently replacing the agent', async () => {
    const manager = new AcpSessionManager()
    try {
      await manager.create(managerArgs('echo'))
      await expect(manager.create(managerArgs('echo'))).rejects.toThrow(/already exists/)
    } finally {
      await manager.closeAll()
    }
  })

  it('refuses to start beyond the concurrency bound', async () => {
    // Why this matters: each session is a live child process, so the bound is
    // what stops a caller from spawning agents until the machine swaps.
    const manager = new AcpSessionManager({ maxSessions: 1 })
    try {
      await manager.create(managerArgs('echo', 'session-1'))
      await expect(manager.create(managerArgs('echo', 'session-2'))).rejects.toThrow(
        /limit of 1 is reached/
      )
    } finally {
      await manager.closeAll()
    }
  })

  it('buffers events so a late subscriber still sees the whole conversation', async () => {
    const manager = new AcpSessionManager()
    try {
      await manager.create(managerArgs('echo'))
      await manager.prompt('session-1', 'hello')

      // The subscriber attaches AFTER the turn, mirroring a window that mounts
      // or reloads late; ACP has no replay, so the buffer is the only source.
      const view = manager.view('session-1')
      expect(view).not.toBeNull()
      const messages = view!.events.filter((event) => event.kind === 'message')
      expect(messages.map((event) => (event.kind === 'message' ? event.text : ''))).toEqual([
        'hello',
        'echo:hello',
        '!'
      ])
    } finally {
      await manager.closeAll()
    }
  })

  it('pushes events to a live subscriber in order', async () => {
    const manager = new AcpSessionManager()
    const seen: AcpSessionEvent[] = []
    const unsubscribe = manager.subscribe((_id, event) => seen.push(event))
    try {
      await manager.create(managerArgs('echo'))
      await manager.prompt('session-1', 'streamed')

      expect(seen.filter((event) => event.kind === 'message').length).toBe(3)
      expect(unsubscribe).toBeTypeOf('function')
    } finally {
      unsubscribe()
      await manager.closeAll()
    }
  })

  it('stops delivering events after unsubscribe', async () => {
    const manager = new AcpSessionManager()
    const seen: AcpSessionEvent[] = []
    const unsubscribe = manager.subscribe((_id, event) => seen.push(event))
    try {
      await manager.create(managerArgs('echo'))
      unsubscribe()
      seen.length = 0
      await manager.prompt('session-1', 'ignored')
      expect(seen).toEqual([])
    } finally {
      await manager.closeAll()
    }
  })

  it('reports an unknown session rather than throwing an opaque error', async () => {
    const manager = new AcpSessionManager()
    expect(manager.view('nope')).toBeNull()
    await expect(manager.prompt('nope', 'hi')).rejects.toThrow(/not found/)
  })

  it('close is idempotent for an unknown session', async () => {
    const manager = new AcpSessionManager()
    await expect(manager.close('never-existed')).resolves.toBeUndefined()
  })

  it('closeAll terminates every agent and empties the registry', async () => {
    const manager = new AcpSessionManager()
    await manager.create(managerArgs('echo', 'session-1'))
    await manager.create(managerArgs('echo', 'session-2'))
    expect(manager.list()).toHaveLength(2)

    await manager.closeAll()
    expect(manager.list()).toEqual([])
  })

  it('retains all events until the user clears the transcript', async () => {
    const manager = new AcpSessionManager()
    try {
      await manager.create(managerArgs('echo'))
      await manager.prompt('session-1', 'before-clear')
      const beforeClear = manager.view('session-1')
      expect(beforeClear!.events.some((event) => event.kind === 'message' && event.text === 'before-clear')).toBe(true)

      manager.clear('session-1')
      expect(manager.view('session-1')!.events).toEqual([])

      await manager.prompt('session-1', 'after-clear')
      expect(manager.view('session-1')!.events.some((event) => event.kind === 'message' && event.text === 'after-clear')).toBe(true)
    } finally {
      await manager.closeAll()
    }
  }, 120_000)
})