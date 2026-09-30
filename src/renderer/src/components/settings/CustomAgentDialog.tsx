import { useRef, useState } from 'react'
import type { CustomAgentProfile } from '../../../../shared/custom-agent-profiles'
import { MAX_CUSTOM_AGENT_LABEL_LENGTH } from '../../../../shared/custom-agent-profiles'
import { createBrowserUuid } from '@/lib/browser-uuid'
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
import { AgentDefaultArgsInput, AgentDefaultEnvInput } from './AgentLaunchDefaultsEditor'
import { translate } from '@/i18n/i18n'

type CustomAgentDialogMode = 'add' | 'edit'

export function createCustomAgentDraft(): CustomAgentProfile {
  return {
    id: `custom-agent-${createBrowserUuid()}`,
    label: '',
    protocol: 'acp',
    command: ''
  }
}

/** Text fields the dialog edits; env is edited through the shared environment input. */
type CustomAgentDraft = {
  id: string
  label: string
  command: string
  args: string
  env: Record<string, string>
}

function draftFromProfile(profile: CustomAgentProfile): CustomAgentDraft {
  return {
    id: profile.id,
    label: profile.label,
    command: profile.command,
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

  // Why a command is required rather than optional: it is the only thing that
  // makes the profile launchable. A saved profile without one could never run,
  // so the dialog must not produce it.
  const command = draft.command.trim()
  const canSave = draft.label.trim().length > 0 && command.length > 0

  const saveDraft = (): void => {
    const label = draft.label.trim()
    if (!label || !command) {
      return
    }
    const args = draft.args.trim()
    onSave({
      id: draft.id,
      label,
      protocol: 'acp',
      command,
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
              ? translate(
                  'auto.components.settings.CustomAgentDialog.editTitle',
                  'Edit Custom Agent'
                )
              : translate(
                  'auto.components.settings.CustomAgentDialog.addTitle',
                  'Add Custom Agent'
                )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.CustomAgentDialog.description',
              'Point Orca at a command that speaks ACP. Orca starts it and drives it like any other agent.'
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
                'e.g. My Agent'
              )}
              maxLength={MAX_CUSTOM_AGENT_LABEL_LENGTH}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-agent-command">
              {translate('auto.components.settings.CustomAgentDialog.commandLabel', 'Command')}
            </Label>
            <Input
              id="custom-agent-command"
              value={draft.command}
              onChange={(event) =>
                setDraft((current) => ({ ...current, command: event.target.value }))
              }
              placeholder={translate(
                'auto.components.settings.CustomAgentDialog.commandPlaceholder',
                'e.g. my-agent'
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.settings.CustomAgentDialog.commandDescription',
                'The executable Orca runs. It must speak ACP over stdin/stdout.'
              )}
            </p>
          </div>

          <AgentDefaultArgsInput
            key={`args:${draft.args}`}
            defaultArgs=""
            argsOverride={draft.args}
            onSaveArgs={(value) => setDraft((current) => ({ ...current, args: value }))}
          />
          <AgentDefaultEnvInput
            key="env"
            defaultEnv={{}}
            envOverride={draft.env}
            onSaveEnv={(value) => setDraft((current) => ({ ...current, env: value }))}
          />
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