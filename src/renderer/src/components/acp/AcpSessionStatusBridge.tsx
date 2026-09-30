import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AcpSessionEvent } from '../../../../shared/acp-types'
import type { Tab } from '../../../../shared/tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import { useAppStore } from '@/store'

type AcpTab = Tab & { contentType: 'acp-session' }

function isAcpTab(tab: Tab): tab is AcpTab {
  return tab.contentType === 'acp-session'
}

/**
 * The row state an ACP session publishes to the sidebar.
 *
 * Why only two states: ACP reports a turn start and a turn end, and nothing in
 * the protocol distinguishes "waiting on the user" from "idle". Inventing a
 * middle state would show the wrong thing for every agent that never sends one.
 */
type AcpTurnState = { state: 'working' | 'done'; prompt: string }

/** Folds one session event into the row state; `null` leaves it unchanged. */
function nextTurnState(
  current: AcpTurnState | undefined,
  event: AcpSessionEvent
): AcpTurnState | null {
  switch (event.kind) {
    case 'turn_start':
      return { state: 'working', prompt: event.text }
    case 'turn_end':
    case 'closed':
      // Keep the prompt: the row shows it beside the settled state.
      return { state: 'done', prompt: current?.prompt ?? '' }
    // Conversation content and session metadata say nothing about the row state.
    case 'commands':
    case 'message':
    case 'thought':
    case 'tool_call':
    case 'plan':
    case 'mode':
    case 'usage':
      return null
  }
}

function AcpSessionStatusProjection({ tab }: { tab: AcpTab }): null {
  // Why the shared pane-key helper: the ACP row must be reachable by the same
  // tab-prefix cleanup and worktree purge paths that own every other agent row,
  // and those key off this exact `tabId:leaf` shape.
  const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
  const turnRef = useRef<AcpTurnState | undefined>(undefined)
  const { entityId, id, label, worktreeId } = tab

  useEffect(() => {
    let live = true
    const publish = (next: AcpTurnState): void => {
      // Why host-owned while working: ACP only stamps turn_start/turn_end on the
      // status row. Mid-turn message/tool/thought traffic keeps the UI busy but
      // never refreshes updatedAt, so the 30-minute freshness TTL would otherwise
      // decay the project/worktree status to idle while the agent is still live.
      // Same bypass structured sessions use for host-held turns.
      useAppStore.getState().setAgentStatus(
        paneKey,
        { state: next.state, prompt: next.prompt, agentType: 'agent' },
        label,
        { updatedAt: Date.now() },
        { tabId: id, worktreeId },
        {
          terminalResumeEligible: false,
          ...(next.state === 'working' ? { structuredHostOwned: true as const } : {})
        }
      )
    }
    // Why seed from `view`: the bridge can mount after the agent started, and the
    // turn-start event would otherwise have been missed, leaving the row idle
    // through a whole turn. `prompting` is the one status that means in-flight.
    const seed = (): void => {
      void window.api.acp
        .view({ sessionId: entityId })
        .then((view) => {
          if (!live || !view) {
            return
          }
          const seeded: AcpTurnState = {
            state: view.summary.status === 'prompting' ? 'working' : 'done',
            prompt: ''
          }
          turnRef.current = seeded
          publish(seeded)
        })
        .catch(() => {
          // A session main does not know yet is not an error worth surfacing here.
        })
    }
    seed()
    const unsubscribe = window.api.acp.onEvent((payload) => {
      if (!live || payload.sessionId !== entityId) {
        return
      }
      const next = nextTurnState(turnRef.current, payload.event)
      if (!next) {
        return
      }
      turnRef.current = next
      publish(next)
    })
    return () => {
      live = false
      unsubscribe()
      useAppStore.getState().removeAgentStatus(paneKey)
    }
  }, [entityId, id, label, paneKey, worktreeId])

  return null
}

/**
 * Publishes every ACP conversation's turn state as an agent-status row.
 *
 * Why a global bridge rather than the panel: the sidebar must show a custom
 * agent as working while its tab is backgrounded, and a backgrounded chat has no
 * mounted pane to publish from — the same reason the structured-session bridge
 * lives at app level.
 */
export function AcpSessionStatusBridge(): React.JSX.Element {
  const tabs = useAppStore(
    useShallow((state) => {
      const acpTabs: AcpTab[] = []
      for (const worktreeTabs of Object.values(state.unifiedTabsByWorktree)) {
        for (const tab of worktreeTabs) {
          if (isAcpTab(tab)) {
            acpTabs.push(tab)
          }
        }
      }
      return acpTabs
    })
  )
  const projections = useMemo(
    () =>
      tabs.map((tab) => <AcpSessionStatusProjection key={`${tab.id}:${tab.entityId}`} tab={tab} />),
    [tabs]
  )
  return <>{projections}</>
}