const version = __APP_VERSION__.trim() || '0.0.0'
const commit = __APP_COMMIT__.trim() || 'unknown'

export const appBuildInfo = {
  version,
  commit,
  displayVersion: commit === 'unknown' ? version : `${version} (${commit})`,
} as const
