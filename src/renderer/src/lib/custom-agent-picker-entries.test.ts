import { describe, expect, it } from 'vitest'
import {
  customAgentGlyph,
  customAgentPickerId,
  findCustomAgentProfileByPickerId,
  getCustomAgentPickerEntries,
  isCustomAgentPickerAgentId,
  isCustomAgentPickerId,
  tuiAgentFromPickerId
} from './custom-agent-picker-entries'
import type { CustomAgentProfile } from '../../../shared/custom-agent-profiles'

function profile(overrides: Partial<CustomAgentProfile> = {}): CustomAgentProfile {
  return {
    id: 'agent-1',
    label: 'My Agent',
    protocol: 'acp',
    command: 'my-agent',
    ...overrides
  }
}

describe('custom agent picker ids', () => {
  it('round-trips a profile id through the picker id', () => {
    const pickerId = customAgentPickerId('agent-1')
    expect(pickerId).toBe('custom:agent-1')
    expect(isCustomAgentPickerId(pickerId)).toBe(true)
    // A custom id must never be mistaken for a built-in TuiAgent.
    expect(tuiAgentFromPickerId(pickerId)).toBeNull()
  })

  it('treats a built-in id as a TuiAgent and not a custom agent', () => {
    expect(isCustomAgentPickerId('claude')).toBe(false)
    expect(tuiAgentFromPickerId('claude')).toBe('claude')
  })

  it('narrows only the custom half of the key space', () => {
    expect(isCustomAgentPickerAgentId('custom:agent-1')).toBe(true)
    expect(isCustomAgentPickerAgentId('claude')).toBe(false)
  })
})

describe('getCustomAgentPickerEntries', () => {
  it('lists saved agents in order with their command line', () => {
    const entries = getCustomAgentPickerEntries([
      profile({ id: 'a', label: 'Alpha', command: 'alpha', args: '--acp' }),
      profile({ id: 'b', label: 'Beta', command: 'beta' })
    ])
    expect(entries).toEqual([
      { id: 'custom:a', profileId: 'a', label: 'Alpha', command: 'alpha --acp' },
      { id: 'custom:b', profileId: 'b', label: 'Beta', command: 'beta' }
    ])
  })

  it('drops a profile with no command, which could never launch', () => {
    // Why: a row that cannot start anything would be a dead entry in the picker.
    const entries = getCustomAgentPickerEntries([
      profile({ id: 'ok', command: 'ok' }),
      profile({ id: 'blank', command: '   ' })
    ])
    expect(entries.map((entry) => entry.profileId)).toEqual(['ok'])
  })

  it('returns nothing for an absent or empty list', () => {
    expect(getCustomAgentPickerEntries(undefined)).toEqual([])
    expect(getCustomAgentPickerEntries([])).toEqual([])
  })
})

describe('findCustomAgentProfileByPickerId', () => {
  it('resolves the profile behind a picker id', () => {
    const profiles = [profile({ id: 'agent-1' }), profile({ id: 'agent-2' })]
    expect(findCustomAgentProfileByPickerId(profiles, 'custom:agent-2')?.id).toBe('agent-2')
  })

  it('returns null for a built-in id rather than guessing a profile', () => {
    expect(findCustomAgentProfileByPickerId([profile()], 'claude')).toBeNull()
  })

  it('returns null for an unknown profile id', () => {
    expect(findCustomAgentProfileByPickerId([profile()], 'custom:missing')).toBeNull()
    expect(findCustomAgentProfileByPickerId(undefined, 'custom:agent-1')).toBeNull()
  })

  it('returns null for a bare prefix with no profile id', () => {
    expect(findCustomAgentProfileByPickerId([profile()], 'custom:')).toBeNull()
  })
})

describe('customAgentGlyph', () => {
  it('uses the first letter of the user label', () => {
    expect(customAgentGlyph({ label: 'my-agent' })).toBe('M')
  })

  it('falls back to a question mark for an empty label', () => {
    // Why: a saved label can be whitespace-only after editing; the tab still
    // needs a glyph rather than an empty box.
    expect(customAgentGlyph({ label: '   ' })).toBe('?')
  })
})