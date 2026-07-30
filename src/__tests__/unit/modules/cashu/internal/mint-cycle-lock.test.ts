import { describe, it, expect } from 'vitest'
import { withMintCycleLock } from '@/modules/cashu/internal/mint-cycle-lock'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('withMintCycleLock', () => {
  it('serializes cycles on the same mint', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => {}

    const first = withMintCycleLock('mint-a', async () => {
      order.push('a1-start')
      await new Promise<void>((r) => {
        releaseFirst = r
      })
      order.push('a1-end')
    })
    await tick()
    const second = withMintCycleLock('mint-a', async () => {
      order.push('a2-start')
    })
    await tick()

    // Second must not start while the first holds the lock
    expect(order).toEqual(['a1-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['a1-start', 'a1-end', 'a2-start'])
  })

  it('lets different mints run concurrently', async () => {
    const order: string[] = []
    let releaseA: () => void = () => {}

    const a = withMintCycleLock('mint-a', async () => {
      order.push('a-start')
      await new Promise<void>((r) => {
        releaseA = r
      })
    })
    await tick()
    const b = withMintCycleLock('mint-b', async () => {
      order.push('b-start')
    })
    await tick()

    expect(order).toEqual(['a-start', 'b-start'])
    releaseA()
    await Promise.all([a, b])
  })

  it('releases the lock when the cycle throws', async () => {
    await expect(
      withMintCycleLock('mint-a', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const ran = await withMintCycleLock('mint-a', async () => 'ok')
    expect(ran).toBe('ok')
  })
})
