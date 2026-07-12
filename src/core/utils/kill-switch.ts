/**
 * Kill-switch registry — switches that disable new code paths.
 *
 * localStorage `zappi.ks.<name>` = '1' turns off that new path and reverts to the old behavior.
 * For per-device support and dev verification only, not a fleet rollback mechanism (that's revert + redeploy).
 * Read once at bootstrap (readKillSwitches) to branch assembly — not a runtime toggle;
 * it takes effect from the next run.
 *
 * Each switch is removed in the release after its migration step stabilizes.
 */

export const KILL_SWITCH_NAMES = [
  'cursor', // gift wrap since/cursor disabled (old behavior: full replay)
  'tls-sweep', // 30s polling instead of the 120s stuck-sweep
  'mint-info-facade', // old health/metadata path instead of MintInfoService
  'recovery-split', // old recoverAll implementation
  'nostr-controller', // old gateway path instead of NostrSessionController
] as const

export type KillSwitchName = (typeof KILL_SWITCH_NAMES)[number]

/** One-shot bootstrap snapshot shape — parameter type for assembly pieces (bootstrap-*.ts). */
export type KillSwitches = Readonly<Record<KillSwitchName, boolean>>

const STORAGE_PREFIX = 'zappi.ks.'

export function isKillSwitchOn(name: KillSwitchName): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + name) === '1'
  } catch {
    // localStorage inaccessible (private mode, etc.) — treat as switch off
    return false
  }
}

/** One-shot snapshot read at bootstrap. */
export function readKillSwitches(): Readonly<Record<KillSwitchName, boolean>> {
  const snapshot = {} as Record<KillSwitchName, boolean>
  for (const name of KILL_SWITCH_NAMES) {
    snapshot[name] = isKillSwitchOn(name)
  }
  return snapshot
}
