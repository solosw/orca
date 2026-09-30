import { describe, expect, it, vi } from 'vitest'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { TabGroupWorktreeSnapshot } from './useTabGroupItemProjections'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T>(factory: () => T) => factory()
  }
})

function acpTab(): Tab {
  return {
    id: 'tab-acp',
    entityId: 'acp-1',
    groupId: 'group-1',
    worktreeId: 'wt-1',
    contentType: 'acp-session',
    customAgentId: 'custom-agent',
    label: 'My Agent',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function snapshot(tab: Tab): TabGroupWorktreeSnapshot {
  const group: TabGroup = {
    id: 'group-1',
    worktreeId: 'wt-1',
    activeTabId: tab.id,
    tabOrder: [tab.id]
  }
  return {
    groups: [group],
    unifiedTabs: [tab],
    terminalTabs: [],
    openFiles: [],
    browserTabs: [],
    expandedPaneByTabId: {},
    terminalLayoutsByTabId: {},
    generatedTabTitlesEnabled: false,
    mobileEmulatorEnabled: true
  }
}

describe('useTabGroupItemProjections ACP tabs', () => {
  it('puts a custom-agent session on the tab strip', async () => {
    const { useTabGroupItemProjections } = await import('./useTabGroupItemProjections')
    const tab = acpTab()
    const projection = useTabGroupItemProjections({
      groupId: 'group-1',
      worktreeId: 'wt-1',
      worktreeState: snapshot(tab)
    })

    expect(projection.agentSessionItems.map((item) => item.id)).toEqual([tab.id])
    expect(projection.tabBarOrder).toEqual([tab.id])
  })
})
