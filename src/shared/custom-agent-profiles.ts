import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'

/** How many custom agents a user may define; keeps the Agents pane and pickers bounded. */
export const MAX_CUSTOM_AGENT_PROFILES = 40
export const MAX_CUSTOM_AGENT_LABEL_LENGTH = 60
export const MAX_CUSTOM_AGENT_COMMAND_LENGTH = 4000
export const MAX_CUSTOM_AGENT_ARGS_LENGTH = 4000
export const MAX_CUSTOM_AGENT_ENV_ENTRIES = 64
export const MAX_CUSTOM_AGENT_ENV_NAME_LENGTH = 200
export const MAX_CUSTOM_AGENT_ENV_VALUE_LENGTH = 4000

/**
 * A user-defined agent that reuses an existing agent's behavior.
 *
 * The base agent stays authoritative for everything Orca must know structurally —
 * prompt injection, readiness detection, trust preflight — so a custom agent needs
 * no new entry in the `TuiAgent` union. The profile only supplies a label and the
 * launch overrides that would otherwise live in per-agent settings.
 */
export type CustomAgentProfile = {
  id: string
  label: string
  /** Existing agent whose launch/readiness behavior this profile reuses. */
  baseAgent: TuiAgent
  /** Replaces the base agent's binary/command; omitted means "use the base agent's command". */
  command?: string
  /** Replaces the configured default arguments for this launch. */
  args?: string
  /** Extra environment for this launch, merged over the base agent's configured environment. */
  env?: Record<string, string>
}

export function getDefaultCustomAgentProfiles(): CustomAgentProfile[] {
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The launch overrides a profile contributes, ready to feed the startup-plan inputs. */
export type CustomAgentLaunchOverrides = {
  command?: string
  args?: string
  env?: Record<string, string>
}

function normalizeCustomAgentEnv(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined
  }
  const nextEnv: Record<string, string> = {}
  for (const [name, raw] of Object.entries(input)) {
    if (Object.keys(nextEnv).length >= MAX_CUSTOM_AGENT_ENV_ENTRIES) {
      break
    }
    const key = name.trim()
    if (!key || typeof raw !== 'string') {
      continue
    }
    nextEnv[key.slice(0, MAX_CUSTOM_AGENT_ENV_NAME_LENGTH)] = raw.slice(
      0,
      MAX_CUSTOM_AGENT_ENV_VALUE_LENGTH
    )
  }
  return Object.keys(nextEnv).length > 0 ? nextEnv : undefined
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

/**
 * Coerces persisted custom agents into a bounded, well-formed list.
 *
 * Why drop a row instead of repairing it: a profile whose base agent is unknown (written by a
 * build that shipped an agent this one does not have) or whose label is empty cannot launch
 * anything meaningful, and keeping it would surface an unusable row in the Agents pane.
 */
export function normalizeCustomAgentProfiles(input: unknown): CustomAgentProfile[] {
  if (!Array.isArray(input)) {
    return getDefaultCustomAgentProfiles()
  }

  const normalized: CustomAgentProfile[] = []
  const seenIds = new Set<string>()

  for (const item of input) {
    if (normalized.length >= MAX_CUSTOM_AGENT_PROFILES) {
      break
    }
    if (!isRecord(item)) {
      continue
    }
    const record = item
    if (!isTuiAgent(record.baseAgent)) {
      continue
    }
    const label = normalizeOptionalText(record.label, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    if (!label) {
      continue
    }
    const rawId = normalizeOptionalText(record.id, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    const idBase = rawId || `custom-agent-${normalized.length + 1}`
    let id = idBase
    let suffix = 2
    while (seenIds.has(id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    seenIds.add(id)

    const command = normalizeOptionalText(record.command, MAX_CUSTOM_AGENT_COMMAND_LENGTH)
    const args = normalizeOptionalText(record.args, MAX_CUSTOM_AGENT_ARGS_LENGTH)
    const env = normalizeCustomAgentEnv(record.env)

    normalized.push({
      id,
      label,
      baseAgent: record.baseAgent,
      ...(command ? { command } : {}),
      ...(args ? { args } : {}),
      ...(env ? { env } : {})
    })
  }

  return normalized
}

export function findCustomAgentProfile(
  profiles: readonly CustomAgentProfile[] | null | undefined,
  id: string | null | undefined
): CustomAgentProfile | null {
  if (!profiles || !id) {
    return null
  }
  return profiles.find((profile) => profile.id === id) ?? null
}

/** True when the profile actually changes anything about how the base agent launches. */
export function customAgentProfileHasLaunchOverrides(profile: CustomAgentProfile): boolean {
  return Boolean(profile.command || profile.args || profile.env)
}

export function getCustomAgentLaunchOverrides(
  profile: CustomAgentProfile | null | undefined
): CustomAgentLaunchOverrides | null {
  if (!profile) {
    return null
  }
  const overrides: CustomAgentLaunchOverrides = {
    ...(profile.command ? { command: profile.command } : {}),
    ...(profile.args ? { args: profile.args } : {}),
    ...(profile.env ? { env: profile.env } : {})
  }
  return Object.keys(overrides).length > 0 ? overrides : null
}

/** The settings slice that decides whether a launch is the user's custom default agent. */
export type CustomAgentDefaultSettings = {
  defaultCustomAgentId?: string | null
  defaultTuiAgent?: TuiAgent | 'blank' | null
  customAgents?: CustomAgentProfile[]
}

/**
 * The overrides to merge into a launch of `agent`, or null when this launch is not the
 * user's default custom agent.
 *
 * A custom agent is a *default-only* choice: `defaultTuiAgent` still stores the profile's base
 * agent, so every icon, picker, and detection reader keeps working off the closed `TuiAgent`
 * union. Only the launch path needs to know the profile exists, which is this lookup.
 *
 * Known limitation: this keys off the default preference, not the caller's intent, so an
 * explicit re-pick of the base agent also picks up the profile's overrides.
 */
export function resolveCustomAgentLaunchOverrides(
  settings: CustomAgentDefaultSettings | null | undefined,
  agent: TuiAgent
): CustomAgentLaunchOverrides | null {
  const profile = findCustomAgentProfile(settings?.customAgents, settings?.defaultCustomAgentId)
  if (!profile || profile.baseAgent !== agent) {
    return null
  }
  return getCustomAgentLaunchOverrides(profile)
}