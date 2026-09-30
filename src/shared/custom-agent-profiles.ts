import { ACP_MAX_LAUNCH_ARGS_LENGTH, ACP_MAX_LAUNCH_COMMAND_LENGTH } from './acp-types'

/** How many custom agents a user may define; keeps the Agents pane and pickers bounded. */
export const MAX_CUSTOM_AGENT_PROFILES = 40
export const MAX_CUSTOM_AGENT_LABEL_LENGTH = 60
export const MAX_CUSTOM_AGENT_COMMAND_LENGTH = ACP_MAX_LAUNCH_COMMAND_LENGTH
export const MAX_CUSTOM_AGENT_ARGS_LENGTH = ACP_MAX_LAUNCH_ARGS_LENGTH
export const MAX_CUSTOM_AGENT_ENV_ENTRIES = 64
export const MAX_CUSTOM_AGENT_ENV_NAME_LENGTH = 200
export const MAX_CUSTOM_AGENT_ENV_VALUE_LENGTH = 4000

/** How Orca talks to a custom agent. ACP over stdio is the only supported transport. */
export type CustomAgentProtocol = 'acp'

/**
 * A user-defined agent that Orca launches and drives directly.
 *
 * Why this does NOT reference another agent: a custom agent ships its own
 * binary and speaks ACP (Agent Client Protocol) over stdio, so Orca is only the
 * client. Nothing about it derives from a built-in `TuiAgent` — the command
 * below *is* the agent. That is what makes it a first-class choice rather than a
 * relabelled override of an existing one.
 */
export type CustomAgentProfile = {
  id: string
  label: string
  /** Wire protocol the command speaks. Explicit so a future protocol is additive. */
  protocol: CustomAgentProtocol
  /** Command that starts the agent. Resolved by the host like any other agent binary. */
  command: string
  /** Arguments passed to the command, as a single shell-like string. */
  args?: string
  /** Extra environment for this launch, merged over the inherited environment. */
  env?: Record<string, string>
}

/** What the ACP session needs to start this agent. */
export type CustomAgentAcpLaunch = {
  command: string
  args?: readonly string[]
  env?: Record<string, string>
}

export function getDefaultCustomAgentProfiles(): CustomAgentProfile[] {
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * Why a profile without a command is dropped rather than repaired: the command
 * is what makes the agent an agent. A row missing it can launch nothing, and
 * keeping it would surface an unusable entry in the Agents pane. This also
 * retires pre-ACP rows, which were overrides of a built-in agent rather than
 * agents in their own right — they have no command of their own to run.
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
    const label = normalizeOptionalText(item.label, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    if (!label) {
      continue
    }
    const command = normalizeOptionalText(item.command, MAX_CUSTOM_AGENT_COMMAND_LENGTH)
    if (!command) {
      continue
    }
    const rawId = normalizeOptionalText(item.id, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    const idBase = rawId || `custom-agent-${normalized.length + 1}`
    let id = idBase
    let suffix = 2
    while (seenIds.has(id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    seenIds.add(id)

    const args = normalizeOptionalText(item.args, MAX_CUSTOM_AGENT_ARGS_LENGTH)
    const env = normalizeCustomAgentEnv(item.env)

    normalized.push({
      id,
      label,
      // Stored rows predating the protocol field are ACP by definition; a
      // future protocol must be written explicitly.
      protocol: 'acp',
      command,
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

/**
 * Splits an argument string into argv.
 *
 * Why a splitter rather than passing the whole string through: the spawn
 * chokepoint forbids `shell: true`, so a single string would otherwise reach
 * the agent as one argument. Quotes group, and a backslash escapes the next
 * character inside them — enough for real agent flags, and no attempt at full
 * shell syntax (which the process never sees).
 */
export function splitCustomAgentArgs(args: string | undefined): string[] {
  if (!args) {
    return []
  }
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]
    if (char === '\\' && quote && index + 1 < args.length) {
      current += args[index + 1]
      index += 1
      started = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n') {
      if (started) {
        out.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) {
    out.push(current)
  }
  return out
}

/** The launch descriptor for a profile, or null when it has no command. */
export function getCustomAgentAcpLaunch(
  profile: CustomAgentProfile | null | undefined
): CustomAgentAcpLaunch | null {
  if (!profile || !profile.command.trim()) {
    return null
  }
  const args = splitCustomAgentArgs(profile.args)
  return {
    command: profile.command,
    ...(args.length > 0 ? { args } : {}),
    ...(profile.env ? { env: profile.env } : {})
  }
}

/** The settings slice that names the user's chosen custom agent. */
export type CustomAgentDefaultSettings = {
  defaultCustomAgentId?: string | null
  customAgents?: CustomAgentProfile[]
}

/**
 * The custom agent a launch should use, or null when the launch is not for one.
 *
 * Unlike the pre-ACP model, this does not key off a base agent: a custom agent
 * is selected by id alone, so two profiles can never collide over the same
 * built-in agent, and none of them is constrained by one.
 */
export function resolveCustomAgentProfile(
  settings: CustomAgentDefaultSettings | null | undefined
): CustomAgentProfile | null {
  return findCustomAgentProfile(settings?.customAgents, settings?.defaultCustomAgentId)
}