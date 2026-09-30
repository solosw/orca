import { describe, expect, it } from 'vitest'
import {
  findCustomAgentProfile,
  getCustomAgentAcpLaunch,
  MAX_CUSTOM_AGENT_LABEL_LENGTH,
  MAX_CUSTOM_AGENT_PROFILES,
  normalizeCustomAgentProfiles,
  resolveCustomAgentProfile,
  splitCustomAgentArgs
} from './custom-agent-profiles'

describe('normalizeCustomAgentProfiles', () => {
  it('keeps a well-formed ACP profile', () => {
    expect(
      normalizeCustomAgentProfiles([
        {
          id: 'work-agent',
          label: 'Work Agent',
          command: '/opt/work/agent',
          args: '--verbose',
          env: { TOKEN: 'k' }
        }
      ])
    ).toEqual([
      {
        id: 'work-agent',
        label: 'Work Agent',
        // Always ACP: a profile that can launch is an ACP agent by definition.
        protocol: 'acp',
        command: '/opt/work/agent',
        args: '--verbose',
        env: { TOKEN: 'k' }
      }
    ])
  })

  it('omits optional fields a profile does not set', () => {
    expect(normalizeCustomAgentProfiles([{ label: 'Plain', command: 'agent-bin' }])).toEqual([
      { id: 'custom-agent-1', label: 'Plain', protocol: 'acp', command: 'agent-bin' }
    ])
  })

  it('drops a row with no command, because a command is what makes it an agent', () => {
    // Why: a profile with no command can launch nothing. Keeping it would render
    // an unusable entry in the Agents pane.
    expect(
      normalizeCustomAgentProfiles([
        { id: 'no-command', label: 'Nothing to run' },
        { id: 'blank-command', label: 'Blank', command: '   ' },
        { id: 'kept', label: 'Kept', command: 'agent-bin' }
      ])
    ).toEqual([{ id: 'kept', label: 'Kept', protocol: 'acp', command: 'agent-bin' }])
  })

  it('drops a blank label', () => {
    expect(
      normalizeCustomAgentProfiles([
        { label: '   ', command: 'agent-bin' },
        { label: 'Kept', command: 'agent-bin' }
      ])
    ).toEqual([{ id: 'custom-agent-1', label: 'Kept', protocol: 'acp', command: 'agent-bin' }])
  })

  it('retires pre-ACP rows written as an override of a built-in agent', () => {
    // Why: those rows carried a base agent and no command of their own. Under the
    // ACP model they describe nothing runnable, so they must not survive as a
    // profile that silently fails to launch.
    expect(
      normalizeCustomAgentProfiles([
        { id: 'legacy', label: 'Work Claude', baseAgent: 'claude', args: '--model opus' }
      ])
    ).toEqual([])
  })

  it('returns the empty default for non-array input', () => {
    expect(normalizeCustomAgentProfiles(undefined)).toEqual([])
    expect(normalizeCustomAgentProfiles({ label: 'nope' })).toEqual([])
  })

  it('dedupes colliding ids and falls back to a positional id', () => {
    expect(
      normalizeCustomAgentProfiles([
        { id: 'dup', label: 'First', command: 'a' },
        { id: 'dup', label: 'Second', command: 'b' },
        { label: 'Third', command: 'c' }
      ]).map((profile) => profile.id)
    ).toEqual(['dup', 'dup-2', 'custom-agent-3'])
  })

  it('bounds the list and the label', () => {
    const many = Array.from({ length: MAX_CUSTOM_AGENT_PROFILES + 5 }, (_value, index) => ({
      label: `Agent ${index}`,
      command: 'agent-bin'
    }))
    expect(normalizeCustomAgentProfiles(many)).toHaveLength(MAX_CUSTOM_AGENT_PROFILES)

    const longLabel = 'x'.repeat(MAX_CUSTOM_AGENT_LABEL_LENGTH + 20)
    expect(normalizeCustomAgentProfiles([{ label: longLabel, command: 'a' }])[0].label).toBe(
      longLabel.slice(0, MAX_CUSTOM_AGENT_LABEL_LENGTH)
    )
  })

  it('drops blank environment names and non-string values', () => {
    expect(
      normalizeCustomAgentProfiles([
        { label: 'Env', command: 'a', env: { '  ': 'dropped', KEPT: 'v', BAD: 3 } }
      ])[0].env
    ).toEqual({ KEPT: 'v' })
  })
})

describe('splitCustomAgentArgs', () => {
  it('splits on whitespace', () => {
    expect(splitCustomAgentArgs('--model opus --verbose')).toEqual([
      '--model',
      'opus',
      '--verbose'
    ])
  })

  it('keeps a quoted value as one argument', () => {
    expect(splitCustomAgentArgs('--prompt "hello world" --x')).toEqual([
      '--prompt',
      'hello world',
      '--x'
    ])
  })

  it('supports single quotes and escaped quotes inside them', () => {
    expect(splitCustomAgentArgs(`--note 'it\\'s here'`)).toEqual(['--note', "it's here"])
  })

  it('keeps an escaped space inside a quoted argument', () => {
    expect(splitCustomAgentArgs('--path "/a b/c"')).toEqual(['--path', '/a b/c'])
  })

  it('returns an empty list for undefined or blank input', () => {
    expect(splitCustomAgentArgs(undefined)).toEqual([])
    expect(splitCustomAgentArgs('   ')).toEqual([])
  })

  it('keeps an empty quoted argument rather than dropping it', () => {
    // Why: `--flag ""` means "the empty string", which differs from omitting it.
    expect(splitCustomAgentArgs('--flag ""')).toEqual(['--flag', ''])
  })
})

describe('getCustomAgentAcpLaunch', () => {
  it('builds a launch descriptor from a profile', () => {
    const [profile] = normalizeCustomAgentProfiles([
      { label: 'Work', command: '/opt/agent', args: '--model opus', env: { K: 'v' } }
    ])
    expect(getCustomAgentAcpLaunch(profile)).toEqual({
      command: '/opt/agent',
      args: ['--model', 'opus'],
      env: { K: 'v' }
    })
  })

  it('omits args and env when the profile has none', () => {
    const [profile] = normalizeCustomAgentProfiles([{ label: 'Bare', command: 'agent-bin' }])
    expect(getCustomAgentAcpLaunch(profile)).toEqual({ command: 'agent-bin' })
  })

  it('returns null for a missing profile', () => {
    expect(getCustomAgentAcpLaunch(null)).toBeNull()
    expect(getCustomAgentAcpLaunch(undefined)).toBeNull()
  })
})

describe('findCustomAgentProfile', () => {
  const profiles = normalizeCustomAgentProfiles([
    { id: 'work', label: 'Work', command: 'a' },
    { id: 'home', label: 'Home', command: 'b' }
  ])

  it('finds a profile by id and reports a miss as null', () => {
    expect(findCustomAgentProfile(profiles, 'work')?.label).toBe('Work')
    expect(findCustomAgentProfile(profiles, 'missing')).toBeNull()
    expect(findCustomAgentProfile(null, 'work')).toBeNull()
    expect(findCustomAgentProfile(profiles, null)).toBeNull()
  })
})

describe('resolveCustomAgentProfile', () => {
  const profiles = normalizeCustomAgentProfiles([
    { id: 'work', label: 'Work', command: 'agent-a' },
    { id: 'other', label: 'Other', command: 'agent-b' }
  ])

  it('resolves the selected profile by id alone', () => {
    // Why id alone matters: under the old model, selection also had to match a
    // built-in agent, so two profiles targeting the same agent could not both be
    // expressed. Id-only selection is what makes each profile independent.
    expect(
      resolveCustomAgentProfile({ customAgents: profiles, defaultCustomAgentId: 'other' })?.label
    ).toBe('Other')
  })

  it('returns null when nothing is selected or the id is unknown', () => {
    expect(resolveCustomAgentProfile({ customAgents: profiles })).toBeNull()
    expect(
      resolveCustomAgentProfile({ customAgents: profiles, defaultCustomAgentId: 'gone' })
    ).toBeNull()
    expect(resolveCustomAgentProfile(null)).toBeNull()
  })
})