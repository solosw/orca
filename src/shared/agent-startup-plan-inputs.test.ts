import { describe, expect, it } from 'vitest'
import {
  resolveAgentStartupPlanInputs,
  type AgentStartupSettings
} from './agent-startup-plan-inputs'
import { buildAgentStartupPlan } from './tui-agent-startup'

const EMPTY_SETTINGS: AgentStartupSettings = {}

describe('resolveAgentStartupPlanInputs', () => {
  it('reads the four launch settings and defaults an absent command override map', () => {
    const inputs = resolveAgentStartupPlanInputs({
      agent: 'claude',
      settings: {
        agentCmdOverrides: { claude: 'my-claude' },
        agentDefaultArgs: { claude: '--verbose' },
        agentDefaultEnv: { claude: { FOO: 'bar' } }
      },
      platform: 'darwin',
      isRemote: false
    })

    expect(inputs.cmdOverrides).toEqual({ claude: 'my-claude' })
    expect(inputs.agentArgs).toBe('--verbose')
    expect(inputs.agentEnv).toEqual({ FOO: 'bar' })
    expect(
      resolveAgentStartupPlanInputs({
        agent: 'claude',
        settings: EMPTY_SETTINGS,
        platform: 'darwin',
        isRemote: false
      }).cmdOverrides
    ).toEqual({})
  })

  it('treats an explicit null agentArgs as "no arguments" rather than "use the default"', () => {
    const settings: AgentStartupSettings = { agentDefaultArgs: { claude: '--verbose' } }
    const base = {
      agent: 'claude' as const,
      settings,
      platform: 'darwin' as const,
      isRemote: false
    }

    expect(resolveAgentStartupPlanInputs(base).agentArgs).toBe('--verbose')
    expect(resolveAgentStartupPlanInputs({ ...base, agentArgs: null }).agentArgs).toBeNull()
    expect(resolveAgentStartupPlanInputs({ ...base, agentArgs: '--model opus' }).agentArgs).toBe(
      '--model opus'
    )
  })

  it('classifies the Windows shell only for a local win32 launch', () => {
    const settings: AgentStartupSettings = { terminalWindowsShell: 'git-bash' }

    expect(
      resolveAgentStartupPlanInputs({
        agent: 'claude',
        settings,
        platform: 'win32',
        isRemote: false
      }).shell
    ).toBe('posix')
    // Remote targets need their own shell signal before quoting can be overridden.
    expect(
      resolveAgentStartupPlanInputs({
        agent: 'claude',
        settings,
        platform: 'win32',
        isRemote: true
      }).shell
    ).toBeUndefined()
    expect(
      resolveAgentStartupPlanInputs({
        agent: 'claude',
        settings,
        platform: 'darwin',
        isRemote: false
      }).shell
    ).toBeUndefined()
  })

  it('lets a requested shell override the configured one', () => {
    const inputs = resolveAgentStartupPlanInputs({
      agent: 'claude',
      settings: { terminalWindowsShell: 'git-bash' },
      platform: 'win32',
      isRemote: false,
      windowsShellOverride: 'cmd.exe'
    })

    expect(inputs.shell).toBe('cmd')
  })

  it('ties sessionOptionsOverrideAgentArgs to whether options were actually picked', () => {
    const base = {
      agent: 'codex' as const,
      settings: EMPTY_SETTINGS,
      platform: 'darwin' as const,
      isRemote: false
    }

    const without = resolveAgentStartupPlanInputs(base)
    expect(without.sessionOptionsOverrideAgentArgs).toBe(false)
    expect(without).not.toHaveProperty('sessionOptions')

    const withOptions = resolveAgentStartupPlanInputs({
      ...base,
      sessionOptions: { model: 'gpt-5' }
    })
    expect(withOptions.sessionOptionsOverrideAgentArgs).toBe(true)
    expect(withOptions.sessionOptions).toEqual({ model: 'gpt-5' })
  })
})

describe('a custom agent no longer reshapes a built-in agent launch', () => {
  // Why this is the load-bearing assertion of the ACP model: a custom agent is
  // its own process reached over ACP. If a saved profile could still rewrite a
  // built-in agent's command, arguments, or environment, the two would remain
  // indistinguishable — which is exactly what the model change removes.
  const settingsWithCustomAgents = {
    agentCmdOverrides: { claude: 'from-settings' },
    agentDefaultArgs: { claude: '--verbose' },
    agentDefaultEnv: { claude: { KEEP: '1', ANTHROPIC_API_KEY: 'personal' } }
  } satisfies AgentStartupSettings

  const base = {
    agent: 'claude' as const,
    settings: settingsWithCustomAgents,
    platform: 'darwin' as const,
    isRemote: false
  }

  it('launches a built-in agent from its own settings only', () => {
    const inputs = resolveAgentStartupPlanInputs(base)

    expect(inputs.cmdOverrides.claude).toBe('from-settings')
    expect(inputs.agentArgs).toBe('--verbose')
    expect(inputs.agentEnv).toEqual({ KEEP: '1', ANTHROPIC_API_KEY: 'personal' })
  })

  it('still lets an explicit per-launch argument override win', () => {
    expect(resolveAgentStartupPlanInputs({ ...base, agentArgs: '--model sonnet' }).agentArgs).toBe(
      '--model sonnet'
    )
  })

  it('keeps every other agent override untouched', () => {
    const inputs = resolveAgentStartupPlanInputs({
      ...base,
      settings: { ...settingsWithCustomAgents, agentCmdOverrides: { claude: 'x', codex: 'y' } }
    })

    expect(inputs.cmdOverrides).toEqual({ claude: 'x', codex: 'y' })
  })
})

describe('a picked session option outranks configured launch arguments', () => {
  // Why this composes rather than asserting the flag: the flag's name says what it sets, not what
  // a user sees. What a user sees is one model flag on argv instead of two, and a chat surface
  // that can name the model they picked.
  function commandFor(settings: AgentStartupSettings) {
    return buildAgentStartupPlan({
      ...resolveAgentStartupPlanInputs({
        agent: 'codex',
        settings,
        platform: 'darwin',
        isRemote: false,
        sessionOptions: { model: 'gpt-5' }
      }),
      prompt: '',
      allowEmptyPromptLaunch: true
    })
  }

  it('strips the configured model flag instead of emitting both spellings', () => {
    const plan = commandFor({ agentDefaultArgs: { codex: '--model gpt-5-codex' } })

    expect(plan?.launchCommand).toBe("codex '-m' 'gpt-5'")
    // Without the override the configured flag trailed the picked one and won on argv order.
    expect(plan?.launchCommand).not.toContain('gpt-5-codex')
  })

  it('reports the picked option as launch-backed so the chat surface can render it', () => {
    expect(
      commandFor({ agentDefaultArgs: { codex: '--model gpt-5-codex' } })?.sessionOptions
    ).toEqual({ model: 'gpt-5' })
  })

  it('leaves non-conflicting configured arguments alone', () => {
    expect(commandFor({ agentDefaultArgs: { codex: '--search' } })?.launchCommand).toContain(
      "'--search'"
    )
  })
})
