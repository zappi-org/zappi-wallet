/**
 * MintInfoService — /v1/info 단일 소유자 (설계 §5)
 *
 * 핵심 불변식:
 * - probe 성공 응답은 metadata에 역주입된다(이중 타격 제거)
 * - probe는 reject하지 않는다(실패도 상태 객체)
 * - 30초 미러 캐시 + 동시 probe in-flight 공유
 * - getInfo는 24h 캐시(rawInfo) 우선 — 캐시 히트 시 네트워크 0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MintInfoService } from '@/modules/cashu/mint-info.service'
import type { MintMetadataService } from '@/modules/cashu/internal/mint-metadata'
import type { MintMetadata } from '@/core/types'

const MINT = 'https://mint.test'

function makeMetadataMock() {
  return {
    ingest: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue(null),
    refresh: vi.fn().mockResolvedValue(null),
    peekCached: vi.fn().mockResolvedValue(null),
    setProbeJoiner: vi.fn(),
  } as unknown as MintMetadataService & {
    ingest: ReturnType<typeof vi.fn>
    getMetadata: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    peekCached: ReturnType<typeof vi.fn>
    setProbeJoiner: ReturnType<typeof vi.fn>
  }
}

describe('MintInfoService', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let metadata: ReturnType<typeof makeMetadataMock>
  let service: MintInfoService

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    metadata = makeMetadataMock()
    service = new MintInfoService(metadata)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('checkMint (health probe)', () => {
    it('reports online and INGESTS the response into metadata (역주입)', async () => {
      const info = { name: 'Test Mint', pubkey: 'pk' }
      fetchMock.mockResolvedValue({ ok: true, json: async () => info })

      const status = await service.checkMint(MINT)

      expect(status.isOnline).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(`${MINT}/v1/info`, expect.anything())
      await vi.waitFor(() => expect(metadata.ingest).toHaveBeenCalledWith(MINT, info))
    })

    it('reports offline on network failure without rejecting and without ingest', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      const status = await service.checkMint(MINT)

      expect(status.isOnline).toBe(false)
      expect(status.errorMessage).toBe('network down')
      expect(metadata.ingest).not.toHaveBeenCalled()
    })

    it('reports offline on non-2xx without ingest', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502 })

      const status = await service.checkMint(MINT)

      expect(status.isOnline).toBe(false)
      expect(status.errorMessage).toBe('HTTP 502')
      expect(metadata.ingest).not.toHaveBeenCalled()
    })

    it('serves from the 30s mirror after a completed check', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

      await service.checkMint(MINT)
      const second = await service.checkMint(MINT)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(second.checkMethod).toBe('cached')
    })

    it('shares one in-flight probe across concurrent checks (설계 §6.4)', async () => {
      let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
      fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

      const first = service.checkMint(MINT)
      const second = service.checkMint(MINT)
      resolveFetch({ ok: true, json: async () => ({}) })

      await Promise.all([first, second])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('getCached exposes the mirror synchronously', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
      expect(service.getCached(MINT)).toBeNull()

      await service.checkMint(MINT)
      expect(service.getCached(MINT)?.isOnline).toBe(true)
    })
  })

  describe('getInfo (상세 화면)', () => {
    it('returns rawInfo from the 24h cache without any network', async () => {
      const raw = { name: 'Cached Mint', nuts: {} }
      metadata.getMetadata.mockResolvedValue({
        url: MINT,
        fetchedAt: Date.now(),
        rawInfo: raw,
      } satisfies MintMetadata)

      const info = await service.getInfo(MINT)

      expect(info).toEqual(raw)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('forces a refresh for legacy cache records without rawInfo', async () => {
      metadata.getMetadata.mockResolvedValue({ url: MINT, fetchedAt: Date.now() })
      metadata.refresh.mockResolvedValue({
        url: MINT,
        fetchedAt: Date.now(),
        rawInfo: { name: 'Refreshed' },
      })

      const info = await service.getInfo(MINT)

      expect(metadata.refresh).toHaveBeenCalledWith(MINT)
      expect(info).toEqual({ name: 'Refreshed' })
    })

    it('fresh=true probes immediately and returns the live response (신뢰 추가 검증)', async () => {
      const live = { name: 'Live Mint', pubkey: 'pk' }
      fetchMock.mockResolvedValue({ ok: true, json: async () => live })

      const info = await service.getInfo(MINT, { fresh: true })

      expect(info).toEqual(live)
      expect(metadata.getMetadata).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(metadata.ingest).toHaveBeenCalledWith(MINT, live))
    })

    it('fresh=true returns null for an unreachable mint', async () => {
      fetchMock.mockRejectedValue(new Error('down'))

      const info = await service.getInfo(MINT, { fresh: true })
      expect(info).toBeNull()
    })
  })

  describe('cross-branch in-flight ([N8] — 구현 리뷰 #1)', () => {
    it('registers a probe joiner on the metadata service at construction', () => {
      expect(metadata.setProbeJoiner).toHaveBeenCalledWith(expect.any(Function))
    })

    it('a live probe is joinable as a metadata result after ingest', async () => {
      const joiner = metadata.setProbeJoiner.mock.calls[0][0] as (
        url: string,
      ) => Promise<unknown> | null

      // probe 없음 → null (분기 A가 직접 fetch)
      expect(joiner(MINT)).toBeNull()

      // probe 진행 중 → 합류 Promise 반환, 완료(ingest 후) 시 캐시 레코드
      let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
      fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))
      const ingested = { url: MINT, fetchedAt: Date.now(), rawInfo: { name: 'M' } }
      metadata.peekCached.mockResolvedValue(ingested)

      const probePromise = service.checkMint(MINT)
      const joined = joiner(MINT)
      expect(joined).not.toBeNull()

      resolveFetch({ ok: true, json: async () => ({ name: 'M' }) })
      await probePromise

      await expect(joined).resolves.toBe(ingested)
      // 왕복은 probe 1회뿐
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('joining a FAILED probe yields null (분기 A 실패 시맨틱과 동일)', async () => {
      const joiner = metadata.setProbeJoiner.mock.calls[0][0] as (
        url: string,
      ) => Promise<unknown> | null

      let rejectFetch!: (e: Error) => void
      fetchMock.mockImplementation(() => new Promise((_, reject) => { rejectFetch = reject }))

      const probePromise = service.checkMint(MINT)
      const joined = joiner(MINT)
      rejectFetch(new Error('down'))
      await probePromise

      await expect(joined).resolves.toBeNull()
    })
  })
})
