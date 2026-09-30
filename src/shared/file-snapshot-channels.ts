/**
 * Channel names for the file-snapshot feature, shared so the preload bridge and
 * the main-process handlers cannot drift. Kept off the `git:` prefix
 * deliberately — this runs in folder workspaces that are not repositories.
 */
export const FILE_SNAPSHOT_CHANNELS = {
  status: 'fileSnapshots:status',
  capture: 'fileSnapshots:capture',
  rebuild: 'fileSnapshots:rebuild',
  acceptFile: 'fileSnapshots:acceptFile',
  acceptFiles: 'fileSnapshots:acceptFiles',
  acceptAll: 'fileSnapshots:acceptAll',
  revertFile: 'fileSnapshots:revertFile',
  revertFiles: 'fileSnapshots:revertFiles',
  revertAll: 'fileSnapshots:revertAll',
  content: 'fileSnapshots:content'
} as const