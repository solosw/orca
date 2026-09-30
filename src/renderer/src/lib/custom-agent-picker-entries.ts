import type { CustomAgentProfile } from '../../../shared/custom-agent-profiles'
import { MAX_CUSTOM_AGENT_LABEL_LENGTH } from '../../../shared/custom-agent-profiles'
import type { TuiAgent } from '../../../shared/tui-agent'
import { isTuiAgent } from '../../../shared/tui-agent-config'

/**
 * Prefix that marks a picker id as a custom (ACP) agent rather than a built-in
 * `TuiAgent`.
 *
 * Why an encoded id instead of widening `AgentCatalogEntry.id` to a union of
 * both: the picker, the launch funnel and the unified-tab record all key off one
 * string. A prefixed string keeps those keys opaque — each layer either passes
 * the id through or asks these helpers what it means — instead of forcing every
 * one of them to learn the union.
 */
export const CUSTOM_AGENT_ID_PREFIX = 'custom:'

/** How many arguments a remote command line may carry, matching the main-process bound. */
const MAX_PICKER_ARGS_LENGTH = 4_000

export function customAgentPickerId(profileId: string): string {
  return `${CUSTOM_AGENT_ID_PREFIX}${profileId}`
}

export function isCustomAgentPickerId(value: string): boolean {
  return value.startsWith(CUSTOM_AGENT_ID_PREFIX)
}

/** The profile id behind a picker id, or null when it is not a custom agent. */
export function customAgentProfileIdFromPickerId(value: string): string | null {
  if (!isCustomAgentPickerId(value)) {
    return null
  }
  const profileId = value.slice(CUSTOM_AGENT_ID_PREFIX.length)
  return profileId.length > 0 ? profileId : null
}

/**
 * A custom agent as a picker row.
 *
 * Why not just an `AgentCatalogEntry`: that type's `id` is a `TuiAgent`, and a
 * custom agent deliberately is not one — nothing about it derives from a
 * built-in agent. Keeping the shape separate is what stops a custom profile from
 * being smuggled into a code path that only knows built-ins.
 */
export type CustomAgentPickerEntry = {
  /** Encoded as `custom:<profileId>` so it survives a round trip through a string key. */
  id: string
  profileId: string
  label: string
  /** The command line, shown as the row's secondary line in settings-style lists. */
  command: string
}

function commandLineFor(profile: CustomAgentProfile): string {
  const command = profile.command.trim()
  if (profile.args) {
    return `${command} ${profile.args}`.slice(0, MAX_PICKER_ARGS_LENGTH)
  }
  return command
}

/** Picker rows for the user's saved custom agents, in saved order. */
export function getCustomAgentPickerEntries(
  profiles: readonly CustomAgentProfile[] | null | undefined
): CustomAgentPickerEntry[] {
  if (!profiles || profiles.length === 0) {
    return []
  }
  return profiles
    .filter((profile) => profile.command.trim().length > 0)
    .map((profile) => ({
      id: customAgentPickerId(profile.id),
      profileId: profile.id,
      label: profile.label.slice(0, MAX_CUSTOM_AGENT_LABEL_LENGTH),
      command: commandLineFor(profile)
    }))
}

/** The profile a picker id names, or null when it names a built-in agent. */
export function findCustomAgentProfileByPickerId(
  profiles: readonly CustomAgentProfile[] | null | undefined,
  pickerId: string
): CustomAgentProfile | null {
  const profileId = customAgentProfileIdFromPickerId(pickerId)
  if (!profileId || !profiles) {
    return null
  }
  return profiles.find((profile) => profile.id === profileId) ?? null
}

/**
 * The single-letter glyph for a custom agent's row and tab.
 *
 * Why a letter rather than a favicon: a custom agent is a user's own binary with
 * no published identity, so inventing a domain would show the wrong brand. The
 * first letter of the user's own label is the only honest signal available.
 */
export function customAgentGlyph(entry: { label: string }): string {
  const first = entry.label.trim().charAt(0)
  return first ? first.toUpperCase() : '?'
}

/** Whether a picker id is safe to persist as a tab's agent identity. */
export type CustomAgentPickerAgentId = `custom:${string}`

/**
 * Narrows a picker id to the custom-agent form.
 *
 * Why a predicate and not a cast: the same string flows into persisted tab
 * records, so the caller must be able to prove which half of the key space it is
 * holding instead of asserting it.
 */
export function isCustomAgentPickerAgentId(
  value: string
): value is CustomAgentPickerAgentId {
  return isCustomAgentPickerId(value)
}

/** The built-in id a picker selection carries, or null when it is a custom agent. */
export function tuiAgentFromPickerId(value: string): TuiAgent | null {
  return isCustomAgentPickerId(value) || !isTuiAgent(value) ? null : value
}