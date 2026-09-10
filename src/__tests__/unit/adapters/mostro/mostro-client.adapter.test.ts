import { describe, it, expect, vi } from 'vitest'
import type { ClientStoreSink, SmallOrder, Store } from 'mostro-ts-client'
import { MostroClientAdapter, type MostroClientLike } from '@/adapters/mostro'
import { deriveMostroStoreKey } from '@/adapters/mostro'

const ORDER: SmallOrder = {
  id: 'o1',
  kind: 'sell',
  status: 'pending',
  amount: 1000,
  fiat_code: 'USD',
  min_amount: null,
  max_amount: null,
  fiat_amount: 5,
  payment_method: 'TESTINGFROM-ZAPPI',
  premium: 0,
  buyer_trade_pubkey: null,
  seller_trade_pubkey: null,
  buyer_invoice: null,
  created_at: 1,
  expires_at: null,
  rating: null,
}

function makeFakeClient(orders: SmallOrder[] = [ORDER]) {
  let sink: ClientStoreSink | null = null
  const calls: string[] = []
  const client: MostroClientLike = {
    bind: vi.fn((s: ClientStoreSink) => {
      calls.push('bind')
      sink = s
    }),
    start: vi.fn(async () => {
      calls.push('start')
      sink?.setUser?.({ pubkey: 'fake', lastTradeIndex: 0 })
    }),
    stop: vi.fn(async () => {
      calls.push('stop')
    }),
    fetchOrders: vi.fn(async () => orders),
    createOrder: vi.fn(async () => ({
      orderId: 'o1',
      status: 'pending',
      next: { type: 'none' as const },
    })),
    takeOrder: vi.fn(async () => ({
      orderId: 'o1',
      status: 'pending',
      next: { type: 'add-invoice' as const, amount: 1000 },
    })),
    submitInvoice: vi.fn(async () => 'accepted' as const),
    waitForOrderLive: vi.fn(async () => {}),
    sendTradeAction: vi.fn(async () => {}),
    cancelOrder: vi.fn(async () => {}),
    openDispute: vi.fn(async () => 'd1'),
    rateUser: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
  }
  return {
    client,
    calls,
    emit: (fn: (s: ClientStoreSink) => void) => {
      if (!sink) throw new Error('sink not bound')
      fn(sink)
    },
  }
}

function makeAdapter(fake = makeFakeClient()) {
  const store = { close: vi.fn(async () => {}), wipe: vi.fn(async () => {}) } as unknown as Store
  const adapter = new MostroClientAdapter({
    seed: new Uint8Array(64),
    mostroPubkeyHex: 'a'.repeat(64),
    relays: ['wss://relay.example'],
    store,
    createClient: () => fake.client,
  })
  return { adapter, fake, store }
}

describe('MostroClientAdapter', () => {
  it('binds before start and reaches ready', async () => {
    const { adapter, fake } = makeAdapter()
    const snapshot = await adapter.connect()
    expect(fake.calls).toEqual(['bind', 'start'])
    expect(snapshot.status).toBe('ready')
    expect(snapshot.availability.available).toBe(true)
  })

  it('maps SmallOrder into the SDK-free DTO on setOrders', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    fake.emit((s) => s.setOrders?.([ORDER]))
    expect(adapter.getSnapshot().orders).toEqual([
      {
        id: 'o1',
        kind: 'sell',
        status: 'pending',
        amount: 1000,
        fiatCode: 'USD',
        fiatAmount: 5,
        minAmount: null,
        maxAmount: null,
        paymentMethod: 'TESTINGFROM-ZAPPI',
        premium: 0,
        createdAt: 1,
        expiresAt: null,
      },
    ])
  })

  it('merges trade state on upsertTrade', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    fake.emit((s) => s.upsertTrade?.('o1', { status: 'active', lastAction: 'take-sell' }))
    fake.emit((s) => s.upsertTrade?.('o1', { disputeId: 'd1' }))
    expect(adapter.getSnapshot().trades.o1).toEqual({
      orderId: 'o1',
      status: 'active',
      action: 'take-sell',
      disputeId: 'd1',
    })
  })

  it('delegates createOrder and maps the result', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    const created = await adapter.createOrder({
      kind: 'sell',
      fiatAmount: 5,
      fiatCode: 'USD',
      amount: 1000,
      paymentMethod: 'x',
    })
    expect(created).toEqual({ orderId: 'o1', status: 'pending', next: { type: 'none' } })
    expect(fake.client.createOrder).toHaveBeenCalledOnce()
  })

  it('resolves takeOrder from the cached book', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    fake.emit((s) => s.setOrders?.([ORDER]))
    const result = await adapter.takeOrder({ orderId: 'o1' })
    expect(result).toEqual({
      orderId: 'o1',
      status: 'pending',
      next: { type: 'add-invoice', amount: 1000 },
    })
    expect(fake.client.takeOrder).toHaveBeenCalledWith(ORDER, { invoice: undefined, amount: undefined })
  })

  it('falls back to fetchOrders when the order is not cached', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    const result =     await adapter.takeOrder({ orderId: 'o1' })
    expect(result.next.type).toBe('add-invoice')
    expect(fake.client.fetchOrders).toHaveBeenCalled()
  })

  it('throws when taking an unknown order', async () => {
    const { adapter } = makeAdapter(makeFakeClient([]))
    await adapter.connect()
    await expect(adapter.takeOrder({ orderId: 'nope' })).rejects.toThrow('Mostro order not found')
  })

  it('guards actions before connect', async () => {
    const { adapter } = makeAdapter()
    await expect(adapter.createOrder({ kind: 'sell', fiatAmount: 1, paymentMethod: 'x' })).rejects.toThrow(
      'not connected',
    )
  })

  it('stops the client and goes idle on disconnect', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    await adapter.disconnect()
    expect(fake.calls).toContain('stop')
    expect(adapter.getSnapshot().status).toBe('idle')
    await expect(adapter.submitInvoice('o1', 'lnbc')).rejects.toThrow('not connected')
  })

  it('pushes the current snapshot to new subscribers', async () => {
    const { adapter } = makeAdapter()
    await adapter.connect()
    const listener = vi.fn()
    const unsubscribe = adapter.subscribe({ onSnapshot: listener })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('delegates trade actions', async () => {
    const { adapter, fake } = makeAdapter()
    await adapter.connect()
    await adapter.sendTradeAction('o1', 'release')
    await adapter.cancelOrder('o1')
    await adapter.rateUser('o1', 5)
    await adapter.restore()
    await adapter.waitForOrderLive('o1')
    expect(await adapter.openDispute('o1')).toBe('d1')
    expect(fake.client.sendTradeAction).toHaveBeenCalledWith('o1', 'release')
    expect(fake.client.cancelOrder).toHaveBeenCalledWith('o1')
    expect(fake.client.rateUser).toHaveBeenCalledWith('o1', 5)
    expect(fake.client.restore).toHaveBeenCalledOnce()
    expect(fake.client.waitForOrderLive).toHaveBeenCalledWith('o1', undefined)
    expect(fake.client.openDispute).toHaveBeenCalledWith('o1')
  })

  it('wipes and closes the store on destroy', async () => {
    const { adapter, store } = makeAdapter()
    await adapter.connect()
    await adapter.destroy()
    expect(store.wipe).toHaveBeenCalledOnce()
    expect(store.close).toHaveBeenCalledOnce()
  })
})

describe('deriveMostroStoreKey', () => {
  it('is a deterministic 32-byte key', () => {
    const seed = new Uint8Array(64).fill(7)
    const a = deriveMostroStoreKey(seed)
    const b = deriveMostroStoreKey(seed)
    expect(a).toHaveLength(32)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
