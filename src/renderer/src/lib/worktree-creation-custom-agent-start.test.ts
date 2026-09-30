import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgentProfile } from '../../../shared/custom-agent-profiles'

const { launchCustomAgentInNewTab, settingsRef } = vi.hoisted(() => ({
  launchCustomAgentInNewTab: vi.fn(),
  settingsRef: { current: undefined as { customAgents?: CustomAgentProfile[] } | undefined }
}))

vi.mock('@/lib/launch-custom-agent-in-new-tab', () => ({ launchCustomAgentInNewTab }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: settingsRef.current }) }
}))

import { startRequestedCustomAgent } from './worktree-creation-custom-agent-start'

function profile(overrides: Partial<CustomAgentProfile> = {}): CustomAgentProfile {
  return {
    id: 'agent-1',
    label: 'My Agent',
    protocol: 'acp',
    command: 'my-agent',
    ...overrides
  }
}

describe('startRequestedCustomAgent', () => {
  beforeEach(() => {
    launchCustomAgentInNewTab.mockReset().mockReturnValue({
      tabId: 'tab-1',
      sessionId: 'acp-1',
      startup: Promise.resolve({ status: 'ready' })
    })
    settingsRef.current = { customAgents: [profile()] }
  })

  it('does nothing for a request that named no custom agent', () => {
    // Why: every ordinary create reaches this seam, so a blank one must be inert.
    const result = startRequestedCustomAgent({
      request: {},
      worktreeId: 'wt-1',
      worktreePath: '/work/wt-1'
    })
    expect(result).toBeNull()
    expect(launchCustomAgentInNewTab).not.toHaveBeenCalled()
  })

  it('starts the saved profile against the created workspace path', () => {
    const result = startRequestedCustomAgent({
      request: { customAgentId: 'agent-1' },
      worktreeId: 'wt-1',
      worktreePath: '/work/wt-1'
    })

    expect(result).toEqual({ tabId: 'tab-1', sessionId: 'acp-1' })
    expect(launchCustomAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        profile: expect.objectContaining({ id: 'agent-1' })
      })
    )
    // The workspace path is the agent's cwd, and there is no connection locally.
    expect(launchCustomAgentInNewTab.mock.calls[0][0].target).toEqual({ cwd: '/work/wt-1' })
  })

  it('carries the SSH connection so the agent runs on that host', () => {
    startRequestedCustomAgent({
      request: { customAgentId: 'agent-1' },
      worktreeId: 'wt-1',
      worktreePath: '/srv/wt-1',
      connectionId: 'ssh-1'
    })

    expect(launchCustomAgentInNewTab.mock.calls[0][0].target).toEqual({
      cwd: '/srv/wt-1',
      connectionId: 'ssh-1'
    })
  })

  it('re-reads the profile from settings so an edited command is the one that runs', () => {
    settingsRef.current = { customAgents: [profile({ command: 'renamed-agent' })] }
    startRequestedCustomAgent({
      request: { customAgentId: 'agent-1' },
      worktreeId: 'wt-1',
      worktreePath: '/work/wt-1'
    })

    expect(launchCustomAgentInNewTab.mock.calls[0][0].profile.command).toBe('renamed-agent')
  })

  it('returns null when the profile was deleted while the workspace was created', () => {
    // Why not a throw: the workspace itself succeeded, so a missing agent is not a
    // create failure — and throwing here would strand the creation surface.
    settingsRef.current = { customAgents: [] }
    expect(
      startRequestedCustomAgent({
        request: { customAgentId: 'agent-1' },
        worktreeId: 'wt-1',
        worktreePath: '/work/wt-1'
      })
    ).toBeNull()
    expect(launchCustomAgentInNewTab).not.toHaveBeenCalled()
  })

  it('returns null when the agent has no launch command', () => {
    launchCustomAgentInNewTab.mockReturnValue(null)
    expect(
      startRequestedCustomAgent({
        request: { customAgentId: 'agent-1' },
        worktreeId: 'wt-1',
        worktreePath: '/work/wt-1'
      })
    ).toBeNull()
  })

  it('does not surface a rejected startup, which the agent tab already reports', () => {
    launchCustomAgentInNewTab.mockReturnValue({
      tabId: 'tab-1',
      sessionId: 'acp-1',
      startup: Promise.reject(new Error('spawn failed'))
    })
    expect(() =>
      startRequestedCustomAgent({
        request: { customAgentId: 'agent-1' },
        worktreeId: 'wt-1',
        worktreePath: '/work/wt-1'
      })
    ).not.toThrow()
  })
})