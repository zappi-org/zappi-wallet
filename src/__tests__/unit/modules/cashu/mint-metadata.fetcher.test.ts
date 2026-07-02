/**
 * MintMetadataService — infoFetcher 주입 경로 (설계 §5.4 분기 A / SP-1)
 *
 * fetcher가 주입되면 raw fetch를 절대 하지 않고 Coco 경유 응답을 ingest한다.
 * rawInfo 원본이 캐시 레코드에 저장되는 것(상세 화면 재사용의 전제)도 검증.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MintMetadataService, type MintInfoResponse } from '@/modules/cashu/internal/mint-metadata'
import type { MetadataStore } from '@/core/ports/driven/metadata-store.port'
import type { MintMetadata } from '@/core/types'

const MINT = 'https://mint.test'

function makeStore() {
  const saved: MintMetadata[] = []
  const store: MetadataStore = {
    get: vi.fn().mockResolvedValue(null),
    getMany: vi.fn().mockResolvedValue(new Map()),
    save: vi.fn().mockImplementation(async (m: MintMetadata) => { saved.push(m) }),
    clear: vi.fn().mockResolvedValue(undefined),
  }
  return { store, saved }
}

describe('MintMetadataService with injected infoFetcher (분기 A)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the fetcher (Coco 경유) and never raw-fetches', async () => {
    const { store, saved } = makeStore()
    const info: MintInfoResponse = { name: 'Coco Mint', icon_url: 'https://i', nuts: { '4': {} } }
    const fetcher = vi.fn().mockResolvedValue(info)
    const service = new MintMetadataService(store, fetcher)

    const metadata = await service.fetchAndCache(MINT)

    expect(fetcher).toHaveBeenCalledWith(MINT)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ url: MINT, name: 'Coco Mint', iconUrl: 'https://i' })
    // 상세 화면 재사용의 전제 — 원본 보존
    expect(saved[0].rawInfo).toEqual(info)
  })

  it('returns null when the fetcher fails (동작 시맨틱 = 레거시 실패와 동일)', async () => {
    const { store } = makeStore()
    const service = new MintMetadataService(store, vi.fn().mockResolvedValue(null))

    expect(await service.fetchAndCache(MINT)).toBeNull()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('falls back to legacy raw fetch when no fetcher is injected (ks.mint-info-facade)', async () => {
    const { store, saved } = makeStore()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ name: 'Legacy Mint' }) })
    const service = new MintMetadataService(store)

    const metadata = await service.fetchAndCache(MINT)

    expect(fetchMock).toHaveBeenCalledWith(`${MINT}/v1/info`, expect.anything())
    expect(metadata?.name).toBe('Legacy Mint')
    expect(saved[0].rawInfo).toEqual({ name: 'Legacy Mint' })
  })

  it('fetchAndCache joins an in-flight health probe instead of fetching ([N8])', async () => {
    const { store } = makeStore()
    const fetcher = vi.fn()
    const service = new MintMetadataService(store, fetcher)

    const probed: MintMetadata = { url: MINT, fetchedAt: Date.now(), rawInfo: { name: 'P' } }
    service.setProbeJoiner(() => Promise.resolve(probed))

    const result = await service.fetchAndCache(MINT)

    expect(result).toBe(probed)
    expect(fetcher).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ingest maps and persists an externally provided response (probe 역주입 경로)', async () => {
    const { store, saved } = makeStore()
    const service = new MintMetadataService(store)

    const metadata = await service.ingest(MINT, { name: 'Probed', pubkey: 'pk' })

    expect(metadata.name).toBe('Probed')
    expect(saved[0]).toMatchObject({ url: MINT, pubkey: 'pk' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
