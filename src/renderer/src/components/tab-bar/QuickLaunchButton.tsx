import React, { useCallback } from 'react'
import { Loader2, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import { AgentLetterIcon } from '@/lib/agent-icon-glyphs'
import { useAppStore } from '@/store'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { resolveAgentLaunchExecutionContext } from '@/lib/launch-agent-execution-context'
import {
  launchCustomAgentInNewTab,
  type AcpLaunchTarget
} from '@/lib/launch-custom-agent-in-new-tab'
import {
  customAgentGlyph,
  getCustomAgentPickerEntries,
  type CustomAgentPickerEntry
} from '@/lib/custom-agent-picker-entries'
import { normalizeCustomAgentProfiles } from '../../../../shared/custom-agent-profiles'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { LaunchSource } from '../../../../shared/telemetry-events'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import { translate } from '@/i18n/i18n'
import { useStructuredAgentLaunchStatus } from '@/lib/structured-agent-session-launch'

export type QuickLaunchAgentMenuItemsProps = {
  worktreeId: string
  groupId: string
  /** Called after the tab is created so keyboard focus lands in the new xterm.
   *  Reuses the TabBar's existing double-rAF handoff — this component does
   *  not duplicate the focus logic. */
  onFocusTerminal: (tabId: string) => void
  /** Optional initial prompt forwarded to `launchAgentInNewTab`. When set,
   *  the picked agent boots with this prompt — argv/flag agents auto-submit,
   *  followup-path agents land it as a draft for the user to confirm. */
  prompt?: string
  /** Use non-default modes for generated context that must not become shell syntax. */
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  /** Telemetry surface for `agent_started.launch_source`. Defaults to
   *  `'tab_bar_quick_launch'` so the existing tab-bar `+` callsite is
   *  unchanged. */
  launchSource?: LaunchSource
  /** Called after a prompt is queued into the agent, or immediately for argv prompt launches. */
  onPromptDelivered?: () => void
}

function getCatalogEntry(agent: TuiAgent): { id: TuiAgent; label: string } | null {
  return getAgentCatalog().find((a) => a.id === agent) ?? null
}

function orderAgents(
  defaultAgent: TuiAgent | 'blank' | null | undefined,
  detected: TuiAgent[]
): TuiAgent[] {
  const inCatalogOrder = getAgentCatalog()
    .filter((entry) => detected.includes(entry.id))
    .map((entry) => entry.id)
  if (!defaultAgent || defaultAgent === 'blank' || !inCatalogOrder.includes(defaultAgent)) {
    return inCatalogOrder
  }
  // Why: surface the user's configured default first — matches the prior
  // split-button behavior where the default agent was the primary action.
  return [defaultAgent, ...inCatalogOrder.filter((id) => id !== defaultAgent)]
}

export function shouldShowLaunchWatchdogTimeout({ hasPty }: { hasPty: boolean }): boolean {
  return !hasPty
}

function getLaunchWatchdogTimeoutMessage(label: string): string {
  return `Couldn't launch ${label} — the terminal did not start.`
}

function getTerminalLaunchState(tabId: string): { stillOpen: boolean; hasPty: boolean } {
  const state = useAppStore.getState()
  const hasPtyBinding = (state.ptyIdsByTabId[tabId]?.length ?? 0) > 0
  let stillOpen = false
  let tabPtyId: string | null = null

  for (const tabs of Object.values(state.tabsByWorktree)) {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) {
      stillOpen = true
      tabPtyId = tab.ptyId
      break
    }
  }

  return { stillOpen, hasPty: hasPtyBinding || tabPtyId !== null }
}

async function waitForTerminalPty(tabId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const launchState = getTerminalLaunchState(tabId)
    if (launchState.hasPty) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return getTerminalLaunchState(tabId).hasPty
}

function QuickLaunchAgentMenuItemsInner({
  worktreeId,
  groupId,
  onFocusTerminal,
  prompt,
  promptDelivery,
  launchSource,
  onPromptDelivered
}: QuickLaunchAgentMenuItemsProps): React.JSX.Element | null {
  // Why: resolving only the SSH connectionId here made paired-runtime
  // worktrees fall back to LOCAL detection, listing the client's agents
  // instead of the remote server's. Use the same ssh/runtime/local owner
  // resolution as the rest of the tab bar.
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(worktreeId)
  const { detectedIds } = useDetectedAgents(agentDetectionTarget)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  // Why the whole settings slice: the custom-agent list is persisted settings
  // state, and the menu must re-render when the user edits it.
  const settings = useAppStore((s) => s.settings)
  const disabledAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const newAgentShortcut = useOptionalShortcutLabel('tab.newAgent')
  // One hook per structured provider: the launch registry is keyed by agent, and hooks cannot run
  // inside the agent list's render loop.
  const structuredLaunchStatusByAgent = {
    claude: useStructuredAgentLaunchStatus(worktreeId, 'claude'),
    codex: useStructuredAgentLaunchStatus(worktreeId, 'codex')
  }

  const openAgentSettings = useCallback(() => {
    openSettingsTarget({ pane: 'agents', repoId: null })
    openSettingsPage()
  }, [openSettingsPage, openSettingsTarget])

  const runLaunch = useCallback(
    (agent: TuiAgent) => {
      const entry = getCatalogEntry(agent)
      const label = entry?.label ?? agent
      const result = launchAgentInNewTab({
        agent,
        worktreeId,
        groupId,
        ...(prompt !== undefined ? { prompt } : {}),
        ...(promptDelivery !== undefined ? { promptDelivery } : {}),
        ...(launchSource !== undefined ? { launchSource } : {}),
        ...(onPromptDelivered !== undefined ? { onPromptDelivered } : {})
      })
      if (!result) {
        toast.error(
          translate(
            'auto.components.tab.bar.QuickLaunchButton.465e432ef1',
            'Could not build launch command for {{value0}}.',
            { value0: label }
          )
        )
        return
      }
      if (result.surface.kind !== 'local-terminal') {
        return
      }
      onFocusTerminal(result.surface.tabId)

      // Why: launch success means the terminal session exists. Agent readiness
      // can lag behind on slow machines, and prompt paste flows already own
      // their own readiness timeout once a PTY exists.
      const launchedTabId = result.surface.tabId
      void waitForTerminalPty(launchedTabId, 5000).then((hasPty) => {
        if (hasPty) {
          return
        }
        const launchState = getTerminalLaunchState(launchedTabId)
        if (!launchState.stillOpen) {
          return
        }
        if (useAppStore.getState().activeWorktreeId !== worktreeId) {
          return
        }
        if (!shouldShowLaunchWatchdogTimeout({ hasPty: launchState.hasPty })) {
          return
        }
        toast.message(getLaunchWatchdogTimeoutMessage(label))
      })
    },
    [worktreeId, groupId, onFocusTerminal, prompt, promptDelivery, launchSource, onPromptDelivered]
  )

  const enabledDetectedIds = detectedIds ? filterEnabledTuiAgents(detectedIds, disabledAgents) : []
  const agents = detectedIds ? orderAgents(defaultAgent, enabledDetectedIds) : []

  // Why custom agents are listed regardless of detection: they are the user's own
  // commands, so there is no PATH probe that could decide whether one is
  // "installed" — the user defined it, and a failed start is reported in its tab.
  const customAgentProfiles = normalizeCustomAgentProfiles(settings?.customAgents)
  const customAgentEntries = getCustomAgentPickerEntries(customAgentProfiles)

  const runCustomAgentLaunch = useCallback(
    (entry: CustomAgentPickerEntry) => {
      const profile = customAgentProfiles.find(
        (candidate) => candidate.id === entry.profileId
      )
      if (!profile) {
        return
      }
      const store = useAppStore.getState()
      const worktree = store.allWorktrees?.().find((candidate) => candidate.id === worktreeId)
      const context = resolveAgentLaunchExecutionContext(store, { worktreeId })
      // Why the workspace path is the target: a custom agent runs *in* the
      // workspace it was launched from, and for an SSH worktree that same path
      // is resolved on the host by the remote transport.
      const target: AcpLaunchTarget = {
        cwd: worktree?.path ?? '',
        ...(context.worktreeSshConnectionId
          ? { connectionId: context.worktreeSshConnectionId }
          : {})
      }
      const result = launchCustomAgentInNewTab({
        profile,
        worktreeId,
        groupId,
        target
      })
      if (!result) {
        toast.error(
          translate(
            'auto.components.tab.bar.QuickLaunchButton.customAgentLaunchFailed',
            'Could not start {{value0}} — it has no command.',
            { value0: entry.label }
          )
        )
        return
      }
      onFocusTerminal(result.tabId)
    },
    [customAgentProfiles, groupId, onFocusTerminal, worktreeId]
  )

  return (
    <>
      {agents.length === 0 ? (
        <DropdownMenuItem
          disabled
          className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 text-muted-foreground"
        >
          {detectedIds && detectedIds.length > 0
            ? translate('auto.components.tab.bar.QuickLaunchButton.8dea9b5cdf', 'No enabled agents')
            : translate(
                'auto.components.tab.bar.QuickLaunchButton.e518f544b1',
                'No agents detected'
              )}
        </DropdownMenuItem>
      ) : null}
      {agents.map((agent) => {
        const entry = getCatalogEntry(agent)
        const label = entry?.label ?? agent
        const isStructuredLaunchPending =
          isAgentSessionHandleProvider(agent) && structuredLaunchStatusByAgent[agent] === 'pending'
        const showsDefaultAgentShortcut =
          newAgentShortcut !== null && defaultAgent !== 'blank' && agent === defaultAgent
        return (
          <DropdownMenuItem
            key={agent}
            disabled={isStructuredLaunchPending}
            onSelect={() => runLaunch(agent)}
            className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
            title={translate(
              'auto.components.tab.bar.QuickLaunchButton.ec2adf093e',
              'Launch {{value0}} in a new terminal',
              { value0: label }
            )}
          >
            {isStructuredLaunchPending ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <AgentIcon agent={agent} size={14} />
            )}
            <span className="flex-1">{label}</span>
            {showsDefaultAgentShortcut ? (
              <DropdownMenuShortcut>{newAgentShortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        )
      })}
      {/* Why after the built-ins and before settings: custom agents are an
          addition the user made, so they read as a group rather than
          interleaving with detected agents the user did not choose. */}
      {customAgentEntries.length > 0 ? (
        <>
          <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {translate(
              'auto.components.tab.bar.QuickLaunchButton.customAgents',
              'Custom agents'
            )}
          </div>
          {customAgentEntries.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => runCustomAgentLaunch(entry)}
              className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
              title={translate(
                'auto.components.tab.bar.QuickLaunchButton.launchCustomAgent',
                'Start {{value0}} ({{value1}})',
                { value0: entry.label, value1: entry.command }
              )}
            >
              <AgentLetterIcon letter={customAgentGlyph(entry)} size={14} />
              <span className="flex-1 truncate">{entry.label}</span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      <DropdownMenuItem
        onSelect={openAgentSettings}
        className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium text-muted-foreground"
      >
        <SettingsIcon className="size-4" />
        {translate('auto.components.tab.bar.QuickLaunchButton.348a04c1ad', 'Agent settings…')}
      </DropdownMenuItem>
    </>
  )
}

export const QuickLaunchAgentMenuItems = React.memo(QuickLaunchAgentMenuItemsInner)
