import { Ok, Err } from '@/core/domain/result'
import { SecurityError } from '@/core/errors/security'
import type { SecurityUseCase } from '@/core/ports/driving/security.usecase'
import { useSecurityHandlers } from '@/ui/hooks/use-security-handlers'
import { useAppStore } from '@/store'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guards against discriminant inversion after the switch to the Result union.
 * Pins that `.ok` on money-adjacent paths (verifyPassword/unlock/logout)
 * behaves identically to the old class-based isOk()/isErr() semantics.
 */

function createSecurityMock(overrides?: Partial<SecurityUseCase>): SecurityUseCase {
  return {
    hasWallet: vi.fn().mockResolvedValue(true),
    createWallet: vi.fn(),
    unlock: vi.fn(),
    verifyPassword: vi.fn().mockResolvedValue(Ok(true)),
    changePassword: vi.fn().mockResolvedValue(Ok(undefined)),
    getMnemonic: vi.fn().mockResolvedValue(Ok('test mnemonic words')),
    deleteWallet: vi.fn().mockResolvedValue(undefined),
    generateMnemonic: vi.fn(),
    validateMnemonic: vi.fn(),
    getCachedKeys: vi.fn().mockReturnValue(null),
    getCachedSeed: vi.fn().mockReturnValue(null),
    lock: vi.fn(),
    ...overrides,
  } as SecurityUseCase
}

const reloadMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload: reloadMock },
    writable: true,
  })
})

function render(security: SecurityUseCase, wipeAccount = vi.fn().mockResolvedValue(undefined)) {
  const { result } = renderHook(() => useSecurityHandlers({ security, wipeAccount }))
  return { handlers: result.current, wipeAccount }
}

describe('useSecurityHandlers — Result discriminant (.ok) semantics', () => {
  describe('handleChangePassword', () => {
    it('Ok → true', async () => {
      const { handlers } = render(createSecurityMock())
      await expect(handlers.handleChangePassword('old', 'new')).resolves.toBe(true)
    })

    it('Err(INVALID_PASSWORD) → false', async () => {
      const security = createSecurityMock({
        changePassword: vi.fn().mockResolvedValue(Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleChangePassword('bad', 'new')).resolves.toBe(false)
    })

    it('Err(CHANGE_PASSWORD_FAILED) = infra failure → throw (must not mislabel as wrongCurrentPin)', async () => {
      const security = createSecurityMock({
        changePassword: vi.fn().mockResolvedValue(Err(new SecurityError('CHANGE_PASSWORD_FAILED', 'storage write failed'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleChangePassword('old', 'new')).rejects.toMatchObject({
        code: 'CHANGE_PASSWORD_FAILED',
      })
    })
  })

  describe('handleVerifyPin', () => {
    it('Ok(true) → true', async () => {
      const { handlers } = render(createSecurityMock())
      await expect(handlers.handleVerifyPin('123456')).resolves.toBe(true)
    })

    it('Ok(false) = PIN mismatch → false', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Ok(false)),
      })
      const { handlers } = render(security)
      await expect(handlers.handleVerifyPin('000000')).resolves.toBe(false)
    })

    it('Err(VERIFY_FAILED) = storage read failure → throw (must not mislabel as wrongPin, R2-B #4)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('VERIFY_FAILED', 'storage read failed'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleVerifyPin('123456')).rejects.toMatchObject({ code: 'VERIFY_FAILED' })
    })
  })

  describe('handleBackupMnemonic', () => {
    it('Ok → returns mnemonic', async () => {
      const { handlers } = render(createSecurityMock())
      await expect(handlers.handleBackupMnemonic('123456')).resolves.toBe('test mnemonic words')
    })

    it('Err(INVALID_PASSWORD) → null (PIN mismatch — mnemonic not exposed)', async () => {
      const security = createSecurityMock({
        getMnemonic: vi.fn().mockResolvedValue(Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleBackupMnemonic('000000')).resolves.toBeNull()
    })

    it('Err(GET_MNEMONIC_FAILED) = infra failure → throw (must not mislabel as wrongPin)', async () => {
      const security = createSecurityMock({
        getMnemonic: vi.fn().mockResolvedValue(Err(new SecurityError('GET_MNEMONIC_FAILED', 'decrypt failed'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleBackupMnemonic('123456')).rejects.toMatchObject({
        code: 'GET_MNEMONIC_FAILED',
      })
    })
  })

  describe('handleLogout', () => {
    it('Ok(true) → wipe + reload + true', async () => {
      const { handlers, wipeAccount } = render(createSecurityMock())
      await expect(handlers.handleLogout('123456')).resolves.toBe(true)
      expect(wipeAccount).toHaveBeenCalledTimes(1)
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('Ok(false) = PIN error → false, no wipe', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Ok(false)),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('000000')).resolves.toBe(false)
      expect(wipeAccount).not.toHaveBeenCalled()
      expect(reloadMock).not.toHaveBeenCalled()
    })

    it('Err(NO_WALLET) = half-wiped state → rescue: resume wipe + true (semantics preserved)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('NO_WALLET', 'No wallet found'))),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('123456')).resolves.toBe(true)
      expect(wipeAccount).toHaveBeenCalledTimes(1)
    })

    it('Err(VERIFY_FAILED) = infra failure → throw, no wipe/reload (R2-B #4)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('VERIFY_FAILED', 'storage read failed'))),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('123456')).rejects.toMatchObject({ code: 'VERIFY_FAILED' })
      expect(wipeAccount).not.toHaveBeenCalled()
      expect(reloadMock).not.toHaveBeenCalled()
    })

    it('wipe failure propagates via throw (no fake success)', async () => {
      const wipeAccount = vi.fn().mockRejectedValue(new Error('wipe failed'))
      const { handlers } = render(createSecurityMock(), wipeAccount)
      await expect(handlers.handleLogout('123456')).rejects.toThrow('wipe failed')
      expect(reloadMock).not.toHaveBeenCalled()
    })
  })

  describe('handleAutoLock', () => {
    it('wipes in-memory secrets + locks UI', () => {
      const security = createSecurityMock()
      const { handlers } = render(security)
      handlers.handleAutoLock()
      expect(security.lock).toHaveBeenCalledTimes(1)
      expect(useAppStore.getState().isLocked).toBe(true)
    })
  })
})
