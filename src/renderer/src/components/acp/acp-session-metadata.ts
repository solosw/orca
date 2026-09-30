import type {
  AcpCommand,
  AcpContextUsage,
  AcpPlanEntry,
  AcpSessionEvent,
  AcpSessionModeState
} from '../../../../shared/acp-types'

export type AcpSessionMetadata = {
  commands: AcpCommand[] | undefined
  contextUsage: AcpContextUsage | null
  plan: AcpPlanEntry[] | null
  modes: AcpSessionModeState | null
}

export function metadataFromAcpEvents(
  events: readonly AcpSessionEvent[],
  initialModes: AcpSessionModeState | null
): AcpSessionMetadata {
  let commands: AcpCommand[] | undefined
  let contextUsage: AcpContextUsage | null = null
  let plan: AcpPlanEntry[] | null = null
  let modes = initialModes

  for (const event of events) {
    switch (event.kind) {
      case 'commands':
        commands = event.commands
        break
      case 'usage':
        contextUsage = { used: event.used, size: event.size }
        break
      case 'plan':
        plan = event.entries
        break
      case 'mode':
        modes = modes ? { ...modes, currentModeId: event.currentModeId } : modes
        break
      case 'message':
      case 'thought':
      case 'tool_call':
      case 'turn_start':
      case 'turn_end':
      case 'closed':
        break
    }
  }

  return { commands, contextUsage, plan, modes }
}
