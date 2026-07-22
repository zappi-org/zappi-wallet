import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { buildTxStateTrack } from '@/ui/screens/TransactionDetail/tx-state-machine'

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx1',
    direction: 'send',
    method: 'cashu',
    protocol: 'cashu-token',
    amount: { value: 1000n, unit: 'sat' },
    accountId: 'https://mint.test',
    status: 'pending',
    createdAt: 1000,
    ...overrides,
  } as Transaction
}

const labels = (tx: Transaction) => buildTxStateTrack(tx).nodes.map((n) => n.labelKey)
const tones = (tx: Transaction) => buildTxStateTrack(tx).nodes.map((n) => n.tone)

describe('buildTxStateTrack', () => {
  it('pending bearer token: created → waiting(current) → used(todo)', () => {
    const tx = makeTx({ outcome: 'unclaimed' })
    expect(labels(tx)).toEqual([
      'txDetail.state.created',
      'txDetail.state.waiting',
      'txDetail.state.used',
    ])
    expect(tones(tx)).toEqual(['done', 'current', 'todo'])
    expect(buildTxStateTrack(tx).noteKey).toBe('txDetail.state.notePending')
  })

  it('claimed bearer token: all done with settle time on the last node', () => {
    const tx = makeTx({ status: 'settled', outcome: 'claimed', completedAt: 2000 })
    expect(tones(tx)).toEqual(['done', 'done', 'done'])
    expect(buildTxStateTrack(tx).nodes[2].at).toBe(2000)
  })

  it('reclaimed bearer token: used is voided, reclaimed carries the settle time', () => {
    const tx = makeTx({ status: 'settled', outcome: 'reclaimed', completedAt: 2000 })
    const track = buildTxStateTrack(tx)
    expect(track.nodes[1]).toMatchObject({ labelKey: 'txDetail.state.reclaimed', tone: 'done', at: 2000 })
    expect(track.nodes[2].tone).toBe('void')
    expect(track.noteKey).toBe('txDetail.state.noteReclaimed')
  })

  it('request-pay is keyed on intent, not protocol', () => {
    const tx = makeTx({ intent: 'request-pay', outcome: 'unclaimed' })
    expect(labels(tx)).toEqual([
      'txDetail.state.sent',
      'txDetail.state.awaitingReceipt',
      'txDetail.state.used',
    ])
  })

  it('failed token send: fail node first, rest voided', () => {
    const tx = makeTx({ status: 'failed', outcome: 'unclaimed', completedAt: 3000 })
    const track = buildTxStateTrack(tx)
    expect(track.nodes[0]).toMatchObject({ labelKey: 'txDetail.state.failed', tone: 'fail', at: 3000 })
    expect(track.nodes.slice(1).every((n) => n.tone === 'void')).toBe(true)
  })

  it('lightning send settled: sent → confirmed', () => {
    const tx = makeTx({ protocol: 'bolt11', status: 'settled', completedAt: 2000 })
    expect(labels(tx)).toEqual(['txDetail.state.sent', 'txDetail.state.confirmed'])
    expect(tones(tx)).toEqual(['done', 'done'])
  })

  it('lightning send in_transit (pending): confirmed is current with a note', () => {
    const tx = makeTx({ protocol: 'bolt11', status: 'pending' })
    expect(tones(tx)).toEqual(['done', 'current'])
    expect(buildTxStateTrack(tx).noteKey).toBe('txDetail.state.noteInTransit')
  })

  it('received token: received → registered', () => {
    const tx = makeTx({ direction: 'receive', status: 'settled', outcome: 'claimed', completedAt: 2000 })
    expect(labels(tx)).toEqual(['txDetail.state.received', 'txDetail.state.registered'])
  })

  it('swap: swapStart → swapDone regardless of direction', () => {
    const tx = makeTx({ intent: 'swap', status: 'settled', completedAt: 2000 })
    expect(labels(tx)).toEqual(['txDetail.state.swapStart', 'txDetail.state.swapDone'])
  })

  it('legacy nut18 send falls back to sent → completed', () => {
    const tx = makeTx({ protocol: 'nut18', status: 'settled', completedAt: 2000 })
    expect(labels(tx)).toEqual(['txDetail.state.sent', 'txDetail.state.completed'])
  })
})
