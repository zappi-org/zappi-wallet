import { Ok, Err } from '@/core/domain/result'
import { SecurityError } from '@/core/errors/security'
import type { SecurityUseCase } from '@/core/ports/driving/security.usecase'
import { useSecurityHandlers } from '@/ui/hooks/use-security-handlers'
import { useAppStore } from '@/store'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Result 유니언 전환(R2-B 1번)의 판별 반전 가드 테스트.
 * 자금-인접 경로(verifyPassword/unlock/logout)에서 `.ok` 판별이
 * 구 클래스형 isOk()/isErr() 시맨틱과 동일하게 동작하는지 행위로 고정한다.
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

describe('useSecurityHandlers — Result 판별(.ok) 시맨틱', () => {
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

    it('Err(CHANGE_PASSWORD_FAILED) = 인프라 실패 → throw (wrongCurrentPin 오표시 금지)', async () => {
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

    it('Ok(false) = PIN 불일치 → false', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Ok(false)),
      })
      const { handlers } = render(security)
      await expect(handlers.handleVerifyPin('000000')).resolves.toBe(false)
    })

    it('Err(VERIFY_FAILED) = 스토리지 read 실패 → throw (wrongPin 오표시 금지, R2-B 4번)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('VERIFY_FAILED', 'storage read failed'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleVerifyPin('123456')).rejects.toMatchObject({ code: 'VERIFY_FAILED' })
    })
  })

  describe('handleBackupMnemonic', () => {
    it('Ok → 니모닉 반환', async () => {
      const { handlers } = render(createSecurityMock())
      await expect(handlers.handleBackupMnemonic('123456')).resolves.toBe('test mnemonic words')
    })

    it('Err(INVALID_PASSWORD) → null (PIN 불일치 — 니모닉 비노출)', async () => {
      const security = createSecurityMock({
        getMnemonic: vi.fn().mockResolvedValue(Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))),
      })
      const { handlers } = render(security)
      await expect(handlers.handleBackupMnemonic('000000')).resolves.toBeNull()
    })

    it('Err(GET_MNEMONIC_FAILED) = 인프라 실패 → throw (wrongPin 오표시 금지)', async () => {
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
    it('Ok(true) → 소거 + reload + true', async () => {
      const { handlers, wipeAccount } = render(createSecurityMock())
      await expect(handlers.handleLogout('123456')).resolves.toBe(true)
      expect(wipeAccount).toHaveBeenCalledTimes(1)
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('Ok(false) = PIN 오류 → false, 소거 없음', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Ok(false)),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('000000')).resolves.toBe(false)
      expect(wipeAccount).not.toHaveBeenCalled()
      expect(reloadMock).not.toHaveBeenCalled()
    })

    it('Err(NO_WALLET) = 반쪽-소거 상태 → 구제: 소거 재개 + true (시맨틱 유지)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('NO_WALLET', 'No wallet found'))),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('123456')).resolves.toBe(true)
      expect(wipeAccount).toHaveBeenCalledTimes(1)
    })

    it('Err(VERIFY_FAILED) = 인프라 실패 → throw, 소거·reload 없음 (R2-B 4번)', async () => {
      const security = createSecurityMock({
        verifyPassword: vi.fn().mockResolvedValue(Err(new SecurityError('VERIFY_FAILED', 'storage read failed'))),
      })
      const { handlers, wipeAccount } = render(security)
      await expect(handlers.handleLogout('123456')).rejects.toMatchObject({ code: 'VERIFY_FAILED' })
      expect(wipeAccount).not.toHaveBeenCalled()
      expect(reloadMock).not.toHaveBeenCalled()
    })

    it('소거 실패는 throw 전파 (성공 가장 금지)', async () => {
      const wipeAccount = vi.fn().mockRejectedValue(new Error('wipe failed'))
      const { handlers } = render(createSecurityMock(), wipeAccount)
      await expect(handlers.handleLogout('123456')).rejects.toThrow('wipe failed')
      expect(reloadMock).not.toHaveBeenCalled()
    })
  })

  describe('handleAutoLock', () => {
    it('메모리 비밀 소거 + UI 잠금', () => {
      const security = createSecurityMock()
      const { handlers } = render(security)
      handlers.handleAutoLock()
      expect(security.lock).toHaveBeenCalledTimes(1)
      expect(useAppStore.getState().isLocked).toBe(true)
    })
  })
})
