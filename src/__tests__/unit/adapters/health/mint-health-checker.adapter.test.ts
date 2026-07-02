import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MintHealthCheckerAdapter } from '@/adapters/health/mint-health-checker.adapter'

const MINT = 'https://mint.test'

describe('MintHealthCheckerAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports online on a 200 response', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const adapter = new MintHealthCheckerAdapter()

    const status = await adapter.checkMint(MINT)

    expect(status.isOnline).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(`${MINT}/v1/info`, expect.anything())
  })

  it('reports offline (never rejects) on fetch failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const adapter = new MintHealthCheckerAdapter()

    const status = await adapter.checkMint(MINT)

    expect(status.isOnline).toBe(false)
    expect(status.errorMessage).toBe('network down')
  })

  /**
   * 설계 §6.4 — 기존 결함: 30초 캐시만 있고 single-flight가 없어,
   * Home mount + reconnect + pull-refresh가 겹치면 같은 민트에 fetch가 중복됐다.
   */
  it('shares one in-flight fetch across concurrent checks of the same mint', async () => {
    let resolveFetch!: (v: { ok: boolean }) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))
    const adapter = new MintHealthCheckerAdapter()

    const first = adapter.checkMint(MINT)
    const second = adapter.checkMint(MINT)
    resolveFetch({ ok: true })

    const [a, b] = await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.isOnline).toBe(true)
    expect(b.isOnline).toBe(true)
  })

  it('does not share in-flight state across different mints', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const adapter = new MintHealthCheckerAdapter()

    await Promise.all([adapter.checkMint(MINT), adapter.checkMint('https://mint.other')])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves from the 30s cache after a completed check', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const adapter = new MintHealthCheckerAdapter()

    await adapter.checkMint(MINT)
    const cached = await adapter.checkMint(MINT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cached.checkMethod).toBe('cached')
  })

  it('checkAllMints checks every mint', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const adapter = new MintHealthCheckerAdapter()

    const statuses = await adapter.checkAllMints([MINT, 'https://mint.other'])

    expect(statuses).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
