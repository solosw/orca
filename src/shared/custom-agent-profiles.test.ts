import { describe, expect, it } from 'vitest'
import {
  customAgentProfileHasLaunchOverrides,
  findCustomAgentProfile,
  getCustomAgentLaunchOverrides,
  MAX_CUSTOM_AGENT_LABEL_LENGTH,
  MAX_CUSTOM_AGENT_PROFILES,
  normalizeCustomAgentProfiles
} from './custom-agent-profiles'

describe('normalizeCustomAgentProfiles', () => {
  it('keeps a well-formed profile with its launch overrides', () => {
    expect(
      normalizeCustomAgentProfiles([
        {
          id: 'work-claude',
          label: 'Work Claude',
          baseAgent: 'claude',
          command: '/opt/work/claude',
          args: '--model opus',
          env: { ANTHROPIC_API_KEY: 'k' }
        }
      ])
    ).toEqual([
      {
        id: 'work-claude',
        label: 'Work Claude',
        baseAgent: 'claude',
        command: '/opt/work/claude',
        args: '--model opus',
        env: { ANTHROPIC_API_KEY: 'k' }
      }
    ])
  })

  it('omits override fields a profile does not set', () => {
    expect(normalizeCustomAgentProfiles([{ label: 'Plain', baseAgent: 'codex' }])).toEqual([
      { id: 'custom-agent-1', label: 'Plain', baseAgent: 'codex' }
    ])
  })

  it('drops rows with an unknown base agent or a blank label', () => {
    // Why: an id from a newer build reads back as unknown here, and a label-less
    // row would render an unusable entry in the Agents pane.
    expect(
      normalizeCustomAgentProfiles([
        { label: 'From the future', baseAgent: 'not-an-agent' },
        { label: '   ', baseAgent: 'claude' },
        { label: 'Kept', baseAgent: 'claude' }
      ])
    ).toEqual([{ id: 'custom-agent-1', label: 'Kept', baseAgent: 'claude' }])
  })

  it('returns the empty default for non-array input', () => {
    expect(normalizeCustomAgentProfiles(undefined)).toEqual([])
    expect(normalizeCustomAgentProfiles({ label: 'nope' })).toEqual([])
  })

  it('dedupes colliding ids and falls back to a positional id', () => {
    expect(
      normalizeCustomAgentProfiles([
        { id: 'dup', label: 'First', baseAgent: 'claude' },
        { id: 'dup', label: 'Second', baseAgent: 'codex' },
        { label: 'Third', baseAgent: 'claude' }
      ]).map((profile) => profile.id)
    ).toEqual(['dup', 'dup-2', 'custom-agent-3'])
  })

  it('bounds the list, the label, and the environment', () => {
    const many = Array.from({ length: MAX_CUSTOM_AGENT_PROFILES + 5 }, (_value, index) => ({
      label: `Agent ${index}`,
      baseAgent: 'claude' as const
    }))
    expect(normalizeCustomAgentProfiles(many)).toHaveLength(MAX_CUSTOM_AGENT_PROFILES)

    const longLabel = 'x'.repeat(MAX_CUSTOM_AGENT_LABEL_LENGTH + 20)
    expect(normalizeCustomAgentProfiles([{ label: longLabel, baseAgent: 'claude' }])[0].label).toBe(
      longLabel.slice(0, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    )
  })

  it('drops blank environment names and non-string values', () => {
    expect(
      normalizeCustomAgentProfiles([
        { label: 'Env', baseAgent: 'claude', env: { '  ': 'dropped', KEPT: 'v', BAD: 3 } }
      ])[0].env
    ).toEqual({ KEPT: 'v' })
  })
})

describe('findCustomAgentProfile', () => {
  const profiles = normalizeCustomAgentProfiles([
    { id: 'work', label: 'Work', baseAgent: 'claude' }
  ])

  it('finds a profile by id and reports a miss as null', () => {
    expect(findCustomAgentProfile(profiles, 'work')?.label).toBe('Work')
    expect(findCustomAgentProfile(profiles, 'missing')).toBeNull()
    expect(findCustomAgentProfile(null, 'work')).toBeNull()
    expect(findCustomAgentProfile(profiles, null)).toBeNull()
  })
})

describe('getCustomAgentLaunchOverrides', () => {
  it('reports only the overrides the profile actually carries', () => {
    const [withCommand] = normalizeCustomAgentProfiles([
      { label: 'Wrap', baseAgent: 'claude', command: 'wrapper' }
    ])
    expect(getCustomAgentLaunchOverrides(withCommand)).toEqual({ command: 'wrapper' })
  })

  it('reports null when a profile changes nothing about the launch', () => {
    const [plain] = normalizeCustomAgentProfiles([{ label: 'Plain', baseAgent: 'claude' }])
    expect(customAgentProfileHasLaunchOverrides(plain)).toBe(false)
    expect(getCustomAgentLaunchOverrides(plain)).toBeNull()
    expect(getCustomAgentLaunchOverrides(null)).toBeNull()
  })
})