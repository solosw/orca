import { useAppStore } from '@/store'
import { launchCustomAgentInNewTab } from '@/lib/launch-custom-agent-in-new-tab'
import { normalizeCustomAgentProfiles } from '../../../shared/custom-agent-profiles'
import type { WorktreeCreationRequest } from './pending-worktree-creation'

/**
 * Starts the ACP agent a create request asked for, once its workspace exists.
 *
 * Why this runs here and not through the TUI startup path: a custom agent is not
 * a `TuiAgent`, and none of that path's machinery applies — there is no launch
 * command to compose, no trust preflight to run against a TUI config, and no
 * prompt to paste into a terminal. The create itself ran exactly as a blank one;
 * this is the only step that differs.
 *
 * Why the profile is re-read from settings instead of carried on the request: an
 * id is what the request holds, so a command edited between submit and completion
 * starts the edited command rather than a stale copy.
 */
export function startRequestedCustomAgent(args: {
  /** The create request; only its `customAgentId` is read. */
  request: Pick<WorktreeCreationRequest, 'customAgentId'>
  worktreeId: string
  worktreePath: string
  connectionId?: string | null
}): { tabId: string; sessionId: string } | null {
  const profileId = args.request.customAgentId
  if (!profileId) {
    return null
  }
  const profiles = normalizeCustomAgentProfiles(
    useAppStore.getState().settings?.customAgents
  )
  const profile = profiles.find((candidate) => candidate.id === profileId)
  if (!profile) {
    // Why silent: the agent may have been deleted while the workspace was being
    // created. The workspace itself succeeded, so this is not a create failure.
    console.warn('worktree create: custom agent no longer exists', profileId)
    return null
  }
  const result = launchCustomAgentInNewTab({
    profile,
    worktreeId: args.worktreeId,
    target: {
      cwd: args.worktreePath,
      ...(args.connectionId ? { connectionId: args.connectionId } : {})
    }
  })
  if (!result) {
    console.warn('worktree create: custom agent has no launch command', profileId)
    return null
  }
  // Why void with a catch: nothing awaits the caller past this point, and a
  // rejected start is already reported inside the agent's own tab.
  void result.startup.catch(() => {})
  return { tabId: result.tabId, sessionId: result.sessionId }
}

/** Starts the configured custom agent when an otherwise-empty workspace is activated. */
export function startDefaultCustomAgentForEmptyWorkspace(args: {
  worktreeId: string
  worktreePath: string
  connectionId?: string | null
}): { tabId: string; sessionId: string } | null {
  const settings = useAppStore.getState().settings
  const profileId = settings?.defaultCustomAgentId
  if (!profileId) {
    return null
  }
  return startRequestedCustomAgent({
    request: { customAgentId: profileId },
    worktreeId: args.worktreeId,
    worktreePath: args.worktreePath,
    connectionId: args.connectionId
  })
}
