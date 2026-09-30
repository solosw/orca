import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { useAppStore } from '@/store'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import AcpSessionPanel from './AcpSessionPanel'

type AcpSessionTab = Tab & { contentType: 'acp-session' }

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

const AcpSessionOverlaySlot = memo(function AcpSessionOverlaySlot({
  tab,
  groupId,
  isActive,
  onFocusOwningGroup
}: {
  tab: AcpSessionTab
  groupId: string | undefined
  isActive: boolean
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}): React.JSX.Element {
  return (
    <RetainedPaneHost
      groupId={groupId}
      isVisible={isActive}
      data-acp-session-overlay-tab-id={tab.id}
      onFocusOwningGroup={onFocusOwningGroup}
    >
      {/* Why entityId is the session id: the ACP session is created before the
          tab, so the tab only has to carry the key back to its conversation. */}
      <AcpSessionPanel sessionId={tab.entityId} title={tab.label} isVisible={isActive} />
    </RetainedPaneHost>
  )
})

/**
 * Renders every ACP conversation in a worktree at the worktree level.
 *
 * Why an overlay layer rather than a pane inside TabGroupPanel: agents keep
 * running while their tab is not focused — a turn in flight must not be torn
 * down by switching tabs, and ACP has no way to reattach to a live session.
 * Keeping each panel mounted and toggling visibility is what preserves the
 * conversation, mirroring how structured agent sessions are hosted.
 */
const AcpSessionPaneOverlayLayer = memo(function AcpSessionPaneOverlayLayer({
  worktreeId,
  isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const { unifiedTabs, groups } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)

  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )
  const groupActiveTabById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.activeTabId] as const)),
    [groups]
  )
  const acpTabs = useMemo(
    () => unifiedTabs.filter((tab): tab is AcpSessionTab => tab.contentType === 'acp-session'),
    [unifiedTabs]
  )

  return (
    <>
      {acpTabs.map((tab) => (
        <AcpSessionOverlaySlot
          key={tab.id}
          tab={tab}
          groupId={tab.groupId}
          isActive={Boolean(isWorktreeActive && groupActiveTabById.get(tab.groupId) === tab.id)}
          onFocusOwningGroup={focusOwningGroup}
        />
      ))}
    </>
  )
})

export default AcpSessionPaneOverlayLayer