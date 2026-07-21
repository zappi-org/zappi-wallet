import { useCallback } from 'react'
import type { SecurityUseCase } from '@/core/ports/driving/security.usecase'
import { useAppStore } from '@/store'

export interface UseSecurityHandlersDeps {
  /** preUnlock.security — security service that exists even before unlock (created via composition, injected by MainApp) */
  security: SecurityUseCase
  /**
   * Full account-data wipe wiring (composition/logout.wipeAccountData).
   * MainApp injects a closure already bound to registry and removePasskey so the
   * hook never imports composition directly (ui/hooks depend only on core ports).
   */
  wipeAccount: () => Promise<void>
}

export interface SecurityHandlers {
  handleAutoLock: () => Promise<void>
  /**
   * false = current-PIN mismatch only (INVALID_PASSWORD). Storage/crypto infra
   * failures (CHANGE_PASSWORD_FAILED, NO_WALLET) throw — the caller's catch
   * surfaces them as lock.errorOccurred, so infra failures aren't mislabeled as
   * wrongPin.
   */
  handleChangePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  /** false = PIN mismatch only. VERIFY_FAILED/NO_WALLET (infra failure) throw. */
  handleVerifyPin: (pin: string) => Promise<boolean>
  /** null = PIN mismatch only. GET_MNEMONIC_FAILED/NO_WALLET (infra failure) throw. */
  handleBackupMnemonic: (password: string) => Promise<string | null>
  /**
   * false = PIN mismatch only. VERIFY_FAILED (infra failure) and wipe failures
   * throw. NO_WALLET resumes wiping via the half-wipe recovery path.
   */
  handleLogout: (password: string) => Promise<boolean>
}

/**
 * Bundle of security handlers: auto-lock trigger, PIN change/verify, mnemonic
 * backup, logout (= full wipe).
 *
 * handleUnlock stays in MainApp because it's the bootstrap shim (calls
 * createBootstrap + swaps the registry generation) — MainApp owns the
 * serviceRegistry state and composition wiring.
 */
export function useSecurityHandlers(deps: UseSecurityHandlersDeps): SecurityHandlers {
  const { security, wipeAccount } = deps
  const setLocked = useAppStore((state) => state.setLocked)

  // Auto-lock: on idle timeout, lock the UI and wipe in-memory secrets (key,
  // seed, mnemonic cache). Keep the registry — a PWA has no OS push, so
  // "receiving while the app is alive" is all there is, and killing the session
  // would revive a reconnect burst on every unlock. Re-evaluate immediately on
  // screen return (compensates for timers frozen during freeze).
  const handleAutoLock = useCallback(async () => {
    // Await the grace clear before flipping the UI to locked — reaching LockScreen
    // must guarantee the PIN-free grace blob is already gone. A clear failure still
    // locks (security.lock logs internally and resolves — fail toward locked).
    await security.lock()
    setLocked(true)
  }, [security, setLocked])

  const handleChangePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<boolean> => {
    const result = await security.changePassword(oldPassword, newPassword)
    // Collapsing infra failures (storage/crypto) into false would mislabel them
    // as "wrong current PIN" — only INVALID_PASSWORD returns false, the rest throw
    // so the caller shows lock.errorOccurred.
    if (!result.ok && result.error.code !== 'INVALID_PASSWORD') throw result.error
    return result.ok
  }, [security])

  const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const result = await security.verifyPassword(pin)
    // Err(VERIFY_FAILED/NO_WALLET) = infra failure — distinct from "PIN mismatch"
    // (Ok(false)). Throw so it branches to lock.errorOccurred instead of
    // mislabeling as wrongPin.
    if (!result.ok) throw result.error
    return result.value
  }, [security])

  const handleBackupMnemonic = useCallback(async (password: string): Promise<string | null> => {
    const result = await security.getMnemonic(password)
    if (result.ok) {
      return result.value
    }
    if (result.error.code === 'INVALID_PASSWORD') {
      return null // PIN mismatch — caller shows wrongPin
    }
    throw result.error // infra failure — caller's catch shows lock.errorOccurred
  }, [security])

  const handleLogout = useCallback(async (password: string): Promise<boolean> => {
    const result = await security.verifyPassword(password)
    // NO_WALLET = half-wiped state where a past wipe stopped after deleting the
    // wallet record (legacy of the old ordering) — no secret to verify, but
    // leftover data remains. Instead of misleading with wrongPin, resume the wipe
    // to give an escape hatch.
    const isHalfWipedState = !result.ok && result.error.code === 'NO_WALLET'
    // Infra failures like VERIFY_FAILED are not "wrong PIN" — throw so
    // SettingsScreen's catch surfaces them as lock.errorOccurred.
    if (!result.ok && !isHalfWipedState) throw result.error
    if (!isHalfWipedState && !(result.ok && result.value)) {
      return false // PIN mismatch — SettingsScreen shows wrongPin
    }
    // Let wipe failures propagate via throw — SettingsScreen surfaces them as
    // lock.errorOccurred (never fake success). Per-piece deletes are replaced by
    // wipeAccountData — everything, including the coco DB, is wiped even when the
    // registry is absent.
    await wipeAccount()
    window.location.reload()
    return true
  }, [security, wipeAccount])

  return {
    handleAutoLock,
    handleChangePassword,
    handleVerifyPin,
    handleBackupMnemonic,
    handleLogout,
  }
}
