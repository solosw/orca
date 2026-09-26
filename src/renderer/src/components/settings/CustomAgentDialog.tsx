import { useRef, useState } from 'react'
import type { CustomAgentProfile } from '../../../../shared/custom-agent-profiles'
import { MAX_CUSTOM_AGENT_LABEL_LENGTH } from '../../../../shared/custom-agent-profiles'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { isTuiAgent, TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import { getAgentCatalog, getAgentLabel } from '@/lib/agent-catalog'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  getTuiAgentDefaultArgs,
  getTuiAgentDefaultEnv
} from '../../../../shared/tui-agent-launch-defaults'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  AgentCommandOverrideInput,
  AgentDefaultArgsInput,
  AgentDefaultEnvInput
} from './AgentLaunchDefaultsEditor'
import { translate } from '@/i18n/i18n'

type CustomAgentDialogMode = 'add' | 'edit'

export function createCustomAgentDraft(): CustomAgentProfile {
  return {
    id: `custom-agent-${createBrowserUuid()}`,
    label: '',
    baseAgent: 'claude'
  }
}

/** Text fields the dialog edits; env is edited through the shared environment input. */
type CustomAgentDraft = {
  id: string
  label: string
  baseAgent: TuiAgent
  command: string
  args: string
  env: Record<string, string>
}

function draftFromProfile(profile: CustomAgentProfile): CustomAgentDraft {
  return {
    id: profile.id,
    label: profile.label,
    baseAgent: profile.baseAgent,
    command: profile.command ?? '',
    args: profile.args ?? '',
    env: profile.env ?? {}
  }
}

export function CustomAgentDialog({
  open,
  mode,
  profile,
  onOpenChange,
  onSave
}: {
  open: boolean
  mode: CustomAgentDialogMode
  profile: CustomAgentProfile
  onOpenChange: (open: boolean) => void
  onSave: (profile: CustomAgentProfile) => void
}): React.JSX.Element {
  const catalog = getAgentCatalog()
  const [draft, setDraft] = useState<CustomAgentDraft>(() => draftFromProfile(profile))
  const syncedProfileRef = useRef(profile)
  const wasOpenRef = useRef(open)

  if (!open) {
    wasOpenRef.current = false
  } else if (!wasOpenRef.current || syncedProfileRef.current !== profile) {
    // Why: the dialog stays mounted across add→edit switches, so reseed the draft
    // from the incoming profile instead of leaving the previous row's text behind.
    wasOpenRef.current = true
    syncedProfileRef.current = profile
    setDraft(draftFromProfile(profile))
  }

  const baseLabel = getAgentLabel(draft.baseAgent)
  const baseDefaultArgs = getTuiAgentDefaultArgs(draft.baseAgent)
  const baseDefaultEnv = getTuiAgentDefaultEnv(draft.baseAgent)

  const canSave = draft.label.trim().length > 0

  const saveDraft = (): void => {
    const label = draft.label.trim()
    if (!label) {
      return
    }
    const command = draft.command.trim()
    const args = draft.args.trim()
    onSave({
      id: draft.id,
      label,
      baseAgent: draft.baseAgent,
      ...(command ? { command } : {}),
      ...(args ? { args } : {}),
      ...(Object.keys(draft.env).length > 0 ? { env: draft.env } : {})
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? translate('auto.components.settings.CustomAgentDialog.editTitle', 'Edit Custom Agent')
              : translate('auto.components.settings.CustomAgentDialog.addTitle', 'Add Custom Agent')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.CustomAgentDialog.description',
              'Reuse an existing agent\u2019s behavior with your own name and launch command.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom-agent-label">
              {translate('auto.components.settings.CustomAgentDialog.nameLabel', 'Name')}
            </Label>
            <Input
              id="custom-agent-label"
              value={draft.label}
              onChange={(event) =>
                setDraft((current) => ({ ...current, label: event.target.value }))
              }
              placeholder={translate(
                'auto.components.settings.CustomAgentDialog.namePlaceholder',
                'e.g. Work Claude'
              )}
              maxLength={MAX_CUSTOM_AGENT_LABEL_LENGTH}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-agent-base">
              {translate('auto.components.settings.CustomAgentDialog.baseLabel', 'Based on')}
            </Label>
            <Select
              value={draft.baseAgent}
              onValueChange={(value) => {
                if (!isTuiAgent(value)) {
                  return
                }
                // Why: switch base agent fields together so a Claude override never trails a
                // freshly picked Codex base; the user then edits from the new agent's defaults.
                setDraft((current) => ({
                  ...current,
                  baseAgent: value,
                  command: '',
                  args: '',
                  env: {}
                }))
              }}
            >
              <SelectTrigger id="custom-agent-base" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.settings.CustomAgentDialog.baseDescription',
                'Determines how Orca starts the agent and detects when it is ready.'
              )}
            </p>
          </div>

          <AgentCommandOverrideInput
            key={`${draft.baseAgent}:${draft.command}`}
            defaultCmd={TUI_AGENT_CONFIG[draft.baseAgent].detectCmd}
            cmdOverride={draft.command || undefined}
            onSaveOverride={(value) => setDraft((current) => ({ ...current, command: value }))}
          />
          <AgentDefaultArgsInput
            key={`${draft.baseAgent}:${draft.args}`}
            defaultArgs={baseDefaultArgs}
            argsOverride={draft.args}
            onSaveArgs={(value) => setDraft((current) => ({ ...current, args: value }))}
          />
          <AgentDefaultEnvInput
            key={`${draft.baseAgent}:env`}
            defaultEnv={baseDefaultEnv}
            envOverride={draft.env}
            onSaveEnv={(value) => setDraft((current) => ({ ...current, env: value }))}
          />
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.CustomAgentDialog.overridesDescription',
              'Leave a field untouched to inherit {{value0}}\u2019s own setting.',
              { value0: baseLabel }
            )}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.CustomAgentDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" size="sm" disabled={!canSave} onClick={saveDraft}>
            {mode === 'edit'
              ? translate('auto.components.settings.CustomAgentDialog.save', 'Save')
              : translate('auto.components.settings.CustomAgentDialog.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}