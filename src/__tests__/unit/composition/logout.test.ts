/**
 * wipeAccountData — 로그아웃 완전 소거 계약 (감사 Phase 1, 이중 리뷰 반영)
 *
 * 핀 대상:
 * - 순서 계약: 타 탭 정지 신호(⓪) → 쓰기 주체 정지(①) → coco DB(②) → zappi DB
 *   clear-first(③) → **니모닉은 마지막 가멸 단계(④)** → localStorage(⑤) →
 *   재broadcast(⑥) → 스토어 리셋(⑦)
 * - 니모닉-마지막 불변식 (이중 리뷰 BLOCKING): ②③ 실패 시 지갑 레코드가 남아
 *   verifyPassword 재시도가 가능해야 한다. 역순은 "니모닉 소멸 + 평문 proofs 잔존
 *   + 재시도 불가 + 온보딩 상속" 반쪽 상태를 만든다.
 * - registry 부재(부트스트랩 전)여도 데이터 소거는 전부 진행
 * - 데이터-소거 단계(②③㉠④)의 실패는 throw 로 표면화 (성공 가장 금지)
 * - db.delete() 는 best-effort: 블록/실패해도 데이터는 ㉠에서 이미 소거 — 진행
 * - localStorage: 계정 데이터만 삭제, 기기 방어/선호(lockout·invite·language·ks)는 유지
 *
 * DB·coco·broadcast 는 경계 모킹, localStorage 어댑터와 스토어는 실물.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wipeAccountData, type WipeAccountDeps } from '@/composition/logout'
import { useAppStore } from '@/store'

const { deleteCocoDataMock, broadcastSyncMock, dbHolder } = vi.hoisted(() => ({
  deleteCocoDataMock: vi.fn(),
  broadcastSyncMock: vi.fn(),
  dbHolder: {
    db: null as unknown as { tables: Array<{ clear: () => Promise<void> }>; delete: () => Promise<void> },
  },
}))

vi.mock('@/modules/cashu', () => ({ deleteCocoData: deleteCocoDataMock }))
vi.mock('@/utils/cross-tab-sync', () => ({ broadcastSync: broadcastSyncMock }))
vi.mock('@/adapters/storage/dexie/schema', () => ({ getDatabase: () => dbHolder.db }))

function makeDb(over?: { failClear?: boolean; deleteImpl?: () => Promise<void> }) {
  const tables = [
    { clear: vi.fn().mockResolvedValue(undefined) },
    {
      clear: over?.failClear
        ? vi.fn().mockRejectedValue(new Error('clear failed'))
        : vi.fn().mockResolvedValue(undefined),
    },
  ]
  const db = { tables, delete: vi.fn(over?.deleteImpl ?? (() => Promise.resolve())) }
  dbHolder.db = db
  return db
}

function makeDeps() {
  return {
    security: { deleteWallet: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    registry: {
      support: { destroy: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
      dispose: vi.fn<() => void>(),
    },
    removePasskey: vi.fn<() => void>(),
  } satisfies WipeAccountDeps
}

function orderOf(fn: { mock: { invocationCallOrder: number[] } }, nth = 0): number {
  return fn.mock.invocationCallOrder[nth]
}

describe('wipeAccountData', () => {
  beforeEach(() => {
    deleteCocoDataMock.mockReset().mockResolvedValue(undefined)
    broadcastSyncMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('순서 계약: 조기 broadcast → 정지 → coco → zappi clear → delete → 니모닉 → localStorage → 재broadcast → 리셋', async () => {
    const db = makeDb()
    const deps = makeDeps()
    const resetAllSpy = vi.spyOn(useAppStore.getState(), 'resetAll')

    try {
      await wipeAccountData(deps)

      // ⓪ 조기 broadcast 가 모든 단계보다 앞 — 타 탭 부활-쓰기 창 차단
      expect(orderOf(broadcastSyncMock, 0)).toBeLessThan(orderOf(deps.registry.support.destroy))
      expect(orderOf(deps.registry.support.destroy)).toBeLessThan(orderOf(deps.registry.dispose))
      expect(orderOf(deps.registry.dispose)).toBeLessThan(orderOf(deleteCocoDataMock))
      expect(orderOf(deleteCocoDataMock)).toBeLessThan(orderOf(db.tables[0].clear))
      expect(orderOf(db.tables[0].clear)).toBeLessThan(orderOf(db.delete))
      // 니모닉-마지막 불변식: 지갑 레코드 삭제는 모든 데이터 소거 뒤
      expect(orderOf(db.delete)).toBeLessThan(orderOf(deps.security.deleteWallet))
      expect(orderOf(deps.security.deleteWallet)).toBeLessThan(orderOf(deps.removePasskey))
      expect(orderOf(deps.removePasskey)).toBeLessThan(orderOf(broadcastSyncMock, 1))
      expect(orderOf(broadcastSyncMock, 1)).toBeLessThan(orderOf(resetAllSpy))

      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
      expect(broadcastSyncMock).toHaveBeenNthCalledWith(1, 'logout')
      expect(broadcastSyncMock).toHaveBeenNthCalledWith(2, 'logout')
    } finally {
      resetAllSpy.mockRestore()
    }
  })

  it('registry 부재(부트스트랩 전)여도 coco DB 포함 전부 소거된다', async () => {
    const db = makeDb()
    const deps = { ...makeDeps(), registry: null }

    await wipeAccountData(deps)

    expect(deleteCocoDataMock).toHaveBeenCalled()
    for (const table of db.tables) expect(table.clear).toHaveBeenCalled()
    expect(deps.security.deleteWallet).toHaveBeenCalled()
    expect(deps.removePasskey).toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
  })

  it('coco DB 삭제 실패 → throw, 니모닉은 남는다 (재시도 가능 상태 보존)', async () => {
    const db = makeDb()
    const deps = makeDeps()
    deleteCocoDataMock.mockRejectedValue(new Error('Coco DB delete timed out'))

    await expect(wipeAccountData(deps)).rejects.toThrow('Coco DB delete timed out')
    expect(db.tables[0].clear).not.toHaveBeenCalled()
    // 핵심: 지갑 레코드가 살아 있어야 verifyPassword → 재시도가 성립한다
    expect(deps.security.deleteWallet).not.toHaveBeenCalled()
    // 조기 broadcast(⓪)만 나갔고 완료 신호(⑥)는 없다
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1)
  })

  it('zappi 테이블 clear 실패 → throw, 니모닉은 남는다', async () => {
    makeDb({ failClear: true })
    const deps = makeDeps()

    await expect(wipeAccountData(deps)).rejects.toThrow('clear failed')
    expect(deps.security.deleteWallet).not.toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1)
  })

  it('니모닉 삭제(④) 실패 → throw, 이후 단계 미실행 — 단 데이터는 이미 소거된 상태', async () => {
    const db = makeDb()
    const deps = makeDeps()
    deps.security.deleteWallet.mockRejectedValue(new Error('secure storage down'))

    await expect(wipeAccountData(deps)).rejects.toThrow('secure storage down')
    // 여기 도달 전에 데이터 소거는 완료 — 재시도하면 멱등 재실행으로 수렴한다
    expect(deleteCocoDataMock).toHaveBeenCalled()
    expect(db.tables[0].clear).toHaveBeenCalled()
    expect(deps.removePasskey).not.toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1) // 완료 신호(⑥) 없음
  })

  it('db.delete() 가 영원히 블록 → 타임아웃 후 warn 하고 계속 (데이터는 ㉠에서 소거됨)', async () => {
    vi.useFakeTimers()
    makeDb({ deleteImpl: () => new Promise<void>(() => {}) })
    const deps = makeDeps()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wipe = wipeAccountData(deps)
      await vi.advanceTimersByTimeAsync(5_000)
      await wipe

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('zappi DB delete blocked/failed after clear'),
        expect.any(Error),
      )
      expect(deps.security.deleteWallet).toHaveBeenCalled()
      expect(deps.removePasskey).toHaveBeenCalled()
      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('db.delete() 즉시 실패도 warn 후 계속', async () => {
    makeDb({ deleteImpl: () => Promise.reject(new Error('delete refused')) })
    const deps = makeDeps()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await wipeAccountData(deps)
      expect(deps.security.deleteWallet).toHaveBeenCalled()
      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('support.destroy 실패는 소거를 중단시키지 않는다 (중단 = 더 많은 데이터 잔존)', async () => {
    makeDb()
    const deps = makeDeps()
    deps.registry.support.destroy.mockRejectedValue(new Error('support down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await wipeAccountData(deps)
      expect(deps.registry.dispose).toHaveBeenCalled()
      expect(deleteCocoDataMock).toHaveBeenCalled()
      expect(deps.security.deleteWallet).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('localStorage 정책: 계정 데이터 삭제, 기기 방어·선호 유지', async () => {
    makeDb()
    // 삭제 대상
    localStorage.setItem('zappi-anchor', '{"eventId":"old"}')
    localStorage.setItem('zappi-balance-cache', '{"total":999}')
    localStorage.setItem('zappi_last_alive_at', String(Date.now()))
    // 유지 대상
    localStorage.setItem('zappi-language', 'ko')
    localStorage.setItem('zappi.ks.cursor', '1')
    localStorage.setItem('zappi_invite_attempts', '3')

    await wipeAccountData(makeDeps())

    expect(localStorage.getItem('zappi-anchor')).toBeNull()
    expect(localStorage.getItem('zappi-balance-cache')).toBeNull()
    expect(localStorage.getItem('zappi_last_alive_at')).toBeNull()
    expect(localStorage.getItem('zappi-language')).toBe('ko')
    expect(localStorage.getItem('zappi.ks.cursor')).toBe('1')
    expect(localStorage.getItem('zappi_invite_attempts')).toBe('3')
  })

  it('스토어 리셋: 이전 계정 상태가 reload 전에도 남지 않는다', async () => {
    makeDb()
    useAppStore.setState({ txRefreshTrigger: 7 })

    await wipeAccountData(makeDeps())

    expect(useAppStore.getState().txRefreshTrigger).toBe(0)
  })
})
