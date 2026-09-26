import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  findCustomAgentProfile,
  normalizeCustomAgentProfiles,
  type CustomAgentProfile
} from '../../../../shared/custom-agent-profiles'
import { getAgentLabel } from '@/lib/agent-catalog'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { Button } from '../ui/button'
import { SettingsBadge, SettingsSubsectionHeader } from './SettingsFormControls'
import { CustomAgentDialog, createCustomAgentDraft } from './CustomAgentDialog'
import { translate } from '@/i18n/i18n'

type EditorState = { mode: 'add' | 'edit'; profile: CustomAgentProfile } | null

/**
 * Where a profile's overrides are summarized under its name.
 *
 * Prefers the command, since that is what a user most often changes; falling back to the base
 * agent's label keeps a profile that only re-labels an agent from rendering an empty row.
 */
export function describeCustomAgentProfile(profile: CustomAgentProfile): string {
  if (profile.command) {
    return profile.args ? `${profile.command} ${profile.args}` : profile.command
  }
  if (profile.args) {
    return profile.args
  }
  return getAgentLabel(profile.baseAgent)
}

export function CustomAgentsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const [editor, setEditor] = useState<EditorState>(null)
  const profiles = normalizeCustomAgentProfiles(settings.customAgents)

  const saveProfile = (next: CustomAgentProfile): void => {
    const existing = findCustomAgentProfile(profiles, next.id)
    const nextProfiles = existing
      ? profiles.map((profile) => (profile.id === next.id ? next : profile))
      : [...profiles, next]
    void updateSettings({ customAgents: nextProfiles })
  }

  const removeProfile = async (profile: CustomAgentProfile): Promise<void> => {
    const confirmed = await confirm({
      title: translate(
        'auto.components.settings.CustomAgentsSetting.deleteTitle',
        'Delete "{{value0}}"?',
        { value0: profile.label }
      ),
      description: translate(
        'auto.components.settings.CustomAgentsSetting.deleteDescription',
        'This custom agent will be removed from your saved list.'
      ),
      confirmLabel: translate('auto.components.settings.CustomAgentsSetting.delete', 'Delete'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) {
      return
    }
    void updateSettings({
      customAgents: profiles.filter((candidate) => candidate.id !== profile.id)
    })
  }

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={
          <span className="flex items-center gap-2">
            {translate('auto.components.settings.CustomAgentsSetting.title', 'Custom Agents')}
            {profiles.length > 0 ? (
              <SettingsBadge tone="muted">{profiles.length}</SettingsBadge>
            ) : null}
          </span>
        }
        description={translate(
          'auto.components.settings.CustomAgentsSetting.description',
          'Give an agent a custom name and launch command, reusing the behavior of an existing agent.'
        )}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditor({ mode: 'add', profile: createCustomAgentDraft() })}
          >
            <Plus />
            {translate(
              'auto.components.settings.CustomAgentsSetting.add',
              'Add Custom Agent'
            )}
          </Button>
        }
      />

      {profiles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/50 px-3 py-3 text-sm text-muted-foreground">
          {translate(
            'auto.components.settings.CustomAgentsSetting.empty',
            'No custom agents yet. Add one to launch an agent with your own command and name.'
          )}
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium leading-none">{profile.label}</span>
                  <SettingsBadge tone="muted">
                    {translate(
                      'auto.components.settings.CustomAgentsSetting.basedOn',
                      'Based on {{value0}}',
                      { value0: getAgentLabel(profile.baseAgent) }
                    )}
                  </SettingsBadge>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {describeCustomAgentProfile(profile)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.settings.CustomAgentsSetting.edit',
                    'Edit custom agent'
                  )}
                  onClick={() => setEditor({ mode: 'edit', profile })}
                  className="size-7"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.settings.CustomAgentsSetting.remove',
                    'Delete custom agent'
                  )}
                  onClick={() => void removeProfile(profile)}
                  className="size-7"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor !== null ? (
        <CustomAgentDialog
          open
          mode={editor.mode}
          profile={editor.profile}
          onOpenChange={(open) => !open && setEditor(null)}
          onSave={saveProfile}
        />
      ) : null}
    </section>
  )
}