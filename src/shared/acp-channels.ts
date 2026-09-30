/**
 * Channel names for the ACP custom-agent feature, shared so the preload bridge
 * and the main-process handlers cannot drift.
 */
export const ACP_CHANNELS = {
  /** Starts a session for a saved custom-agent profile. */
  startSession: 'acp:startSession',
  prompt: 'acp:prompt',
  setMode: 'acp:setMode',
  cancel: 'acp:cancel',
  close: 'acp:close',
  list: 'acp:list',
  /** Summary plus buffered events for one session. */
  view: 'acp:view',
  /** Removes retained transcript events without stopping the agent. */
  clear: 'acp:clear',
  /** The user's answer to a pending permission request. */
  respondPermission: 'acp:respondPermission',
  /** Main → renderer: a reduced session event. */
  event: 'acp:event',
  /** Main → renderer: the agent is asking for a permission decision. */
  permissionRequest: 'acp:permissionRequest'
} as const