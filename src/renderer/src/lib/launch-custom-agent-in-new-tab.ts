import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  findCustomAgentProfileByPickerId,
  customAgentGlyph
} from '@/lib/custom-agent-picker-entries'
import { getCustomAgentAcpLaunch } from '../../../shared/custom-agent-profiles'
import type { CustomAgentProfile } from '../../../shared/custom-agent-profiles'

/** Where an ACP launch runs. `connectionId` absent means this machine. */
export type AcpLaunchTarget = {
  /** Absolute workspace path, local or on the SSH host. */
  cwd: string
  connectionId?: string
}

export type LaunchCustomAgentInNewTabArgs = {
  profile: CustomAgentProfile
  worktreeId: string
  /** Tab group the user launched from; keeps split-group launches in that pane. */
  groupId?: string
  target: AcpLaunchTarget
}

export type LaunchCustomAgentResult = {
  tabId: string
  sessionId: string
  /**
   * The handshake's outcome. Resolves to a failed summary rather than rejecting,
   * because "this binary does not speak ACP" is a status the tab must show.
   */
  startup: Promise<{ status: string; error?: string }>
}

/**
 * The agent's glyph, derived from the user's own label.
 *
 * Why not a catalog icon: a custom agent is the user's own binary with no
 * published identity, so borrowing a built-in agent's icon would misattribute it.
 */
export function customAgentTabLabel(profile: CustomAgentProfile): string {
  return profile.label || customAgentGlyph(profile)
}

/**
 * Starts a custom agent and opens its conversation in a new tab.
 *
 * Why the tab is created before the handshake: the agent process takes time to
 * boot, and the tab is what the user watches while that happens. The tab's
 * `entityId` is the ACP session id, so the panel finds its conversation with no
 * extra state — and a failed start leaves a tab that reports why.
 */
export function launchCustomAgentInNewTab(
  args: LaunchCustomAgentInNewTabArgs
): LaunchCustomAgentResult | null {
  const profile = args.profile
  const launch = getCustomAgentAcpLaunch(profile)
  if (!launch) {
    return null
  }

  const store = useAppStore.getState()
  const sessionId = `acp-${createBrowserUuid()}`
  const groupId = args.groupId ?? undefined

  const tab = store.createUnifiedTab(args.worktreeId, 'acp-session', {
    entityId: sessionId,
    label: customAgentTabLabel(profile),
    customAgentId: profile.id,
    ...(groupId ? { targetGroupId: groupId } : {}),
    activate: true
  })
  store.activateTab(tab.id)
  store.setActiveTabType('acp-session', args.worktreeId)
  store.focusGroup(args.worktreeId, tab.groupId)

  const startup = window.api.acp
    .startSession({
      sessionId,
      title: customAgentTabLabel(profile),
      cwd: args.target.cwd,
      launch,
      ...(args.target.connectionId ? { connectionId: args.target.connectionId } : {})
    })
    .then((summary) => ({
      status: summary.status,
      ...(summary.error ? { error: summary.error } : {})
    }))
    .catch((error: unknown) => ({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }))

  return { tabId: tab.id, sessionId, startup }
}

/** A picker selection that names a saved custom agent, or null for a built-in. */
export function findCustomAgentForPickerSelection(
  pickerId: string
): CustomAgentProfile | null {
  const profiles = useAppStore.getState().settings?.customAgents
  return findCustomAgentProfileByPickerId(profiles, pickerId)
}