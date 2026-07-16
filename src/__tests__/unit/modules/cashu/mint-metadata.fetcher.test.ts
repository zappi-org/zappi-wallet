/**
 * MintMetadataService — injected infoFetcher path.
 *
 * When a fetcher is injected, it never raw-fetches and instead ingests the
 * Coco-routed response. Also verifies the original rawInfo is stored in the
 * cache record (a prerequisite for detail-screen reuse).
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

describe('MintMetadataService with injected infoFetcher (branch A)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the fetcher (via Coco) and never raw-fetches', async () => {
    const { store, saved } = makeStore()
    const info: MintInfoResponse = { name: 'Coco Mint', icon_url: 'https://i', nuts: { '4': {} } }
    const fetcher = vi.fn().mockResolvedValue(info)
    const service = new MintMetadataService(store, fetcher)

    const metadata = await service.fetchAndCache(MINT)

    expect(fetcher).toHaveBeenCalledWith(MINT)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ url: MINT, name: 'Coco Mint', iconUrl: 'https://i' })
    // Prerequisite for detail-screen reuse — preserve the original
    expect(saved[0].rawInfo).toEqual(info)
  })

  it('returns null when the fetcher fails (behavior semantics = same as legacy failure)', async () => {
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

  it('ingest maps and persists an externally provided response (probe back-injection path)', async () => {
    const { store, saved } = makeStore()
    const service = new MintMetadataService(store)

    const metadata = await service.ingest(MINT, { name: 'Probed', pubkey: 'pk' })

    expect(metadata.name).toBe('Probed')
    expect(saved[0]).toMatchObject({ url: MINT, pubkey: 'pk' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
