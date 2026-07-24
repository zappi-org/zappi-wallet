import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import { getTitle, getTypeLabel, isReclaimRow } from '@/ui/components/wallet/transactionHelpers'

// Mirrors the ko locale strings so assertions read like the real UI.
const KO: Record<string, string> = {
  'history.received': '받음',
  'history.sent': '보냄',
  'history.reclaimed': '되찾음',
  'history.receiving': '받는 중',
  'history.sending': '보내는 중',
  'send.receipt.pendingTitle': '전달 대기 중',
  'history.swap': '스왑',
  'history.lightning': '라이트닝',
  'history.nutzap': 'NutZap',
  'history.ecash': '이캐시',
}

const t = ((key: string) => KO[key] ?? key) as unknown as TFunction

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    direction: 'receive',
    method: 'cashu:lightning',
    protocol: 'bolt11',
    amount: sat(1000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('getTitle — title is the ACT, not the means', () => {
  // The opId rollback path writes no receive row, so the settled send row IS
  // the reclaim — keying only on reclaimedFrom would relabel it 보냄.
  it('opId-path reclaim (settled send, outcome reclaimed, no reclaimedFrom) -> 되찾음', () => {
    const tx = makeTx({
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
    })
    expect(getTitle(tx, t)).toBe('되찾음')
  })

  it('legacy token-path reclaim (receive row carrying reclaimedFrom) -> 되찾음', () => {
    const tx = makeTx({
      direction: 'receive',
      status: 'settled',
      metadata: { reclaimedFrom: 'some-tx-id' },
    })
    expect(getTitle(tx, t)).toBe('되찾음')
  })

  // The token path books the reclaim on a companion receive row. If the send
  // row also said 되찾음 the user would see the same reclaim twice.
  it('legacy token-path send half (reclaimed, but has a companion) -> 보냄', () => {
    const tx = makeTx({
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
      metadata: { reclaimCompanionTxId: 'tx1-receive' },
    })
    expect(getTitle(tx, t)).toBe('보냄')
  })

  it('pending + unclaimed sent token -> 전달 대기 중 (reuses send.receipt.pendingTitle)', () => {
    const tx = makeTx({ direction: 'send', status: 'pending', outcome: 'unclaimed' })
    expect(getTitle(tx, t)).toBe('전달 대기 중')
  })

  it('pending receive -> 받는 중', () => {
    const tx = makeTx({ direction: 'receive', status: 'pending' })
    expect(getTitle(tx, t)).toBe('받는 중')
  })

  it('pending send that is not an unclaimed token (e.g. in_transit lightning) -> 보내는 중', () => {
    const tx = makeTx({ direction: 'send', status: 'pending', outcome: undefined })
    expect(getTitle(tx, t)).toBe('보내는 중')
  })

  it('settled receive -> 받음', () => {
    const tx = makeTx({ direction: 'receive', status: 'settled' })
    expect(getTitle(tx, t)).toBe('받음')
  })

  it('settled send -> 보냄', () => {
    const tx = makeTx({ direction: 'send', status: 'settled', outcome: 'claimed' })
    expect(getTitle(tx, t)).toBe('보냄')
  })

  it('failed receive keeps the act label (strikethrough+red dot carry the failure) -> 받음', () => {
    const tx = makeTx({ direction: 'receive', status: 'failed' })
    expect(getTitle(tx, t)).toBe('받음')
  })

  it('failed send keeps the act label -> 보냄', () => {
    const tx = makeTx({ direction: 'send', status: 'failed' })
    expect(getTitle(tx, t)).toBe('보냄')
  })

  it('appends the memo after the act label with a middot separator', () => {
    const tx = makeTx({ direction: 'receive', status: 'settled', memo: '점심값' })
    expect(getTitle(tx, t)).toBe('받음 · 점심값')
  })

  it('does not append a separator when there is no memo', () => {
    const tx = makeTx({ direction: 'receive', status: 'settled', memo: undefined })
    expect(getTitle(tx, t)).toBe('받음')
  })
})

describe('isReclaimRow — exactly one 되찾음 row per reclaim', () => {
  it('token path (two rows): the companion receive is the reclaim, the send is not', () => {
    const sendHalf = makeTx({
      id: 'send-1',
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
      metadata: { reclaimCompanionTxId: 'send-1-receive' },
    })
    const receiveHalf = makeTx({
      id: 'send-1-receive',
      direction: 'receive',
      status: 'settled',
      outcome: 'reclaimed',
      metadata: { reclaimedFrom: 'send-1' },
    })
    expect([sendHalf, receiveHalf].filter(isReclaimRow)).toEqual([receiveHalf])
  })

  it('opId path (one row): the settled send row is the reclaim', () => {
    const sendOnly = makeTx({
      id: 'send-2',
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
    })
    expect([sendOnly].filter(isReclaimRow)).toEqual([sendOnly])
  })

  it('an unstamped companion leaves the send row as the sole reclaim row', () => {
    // The companion stamp is best-effort; if it failed the send row must still
    // read as 되찾음 rather than the reclaim vanishing from history entirely.
    const sendHalf = makeTx({
      id: 'send-3',
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
    })
    const plainReceive = makeTx({ id: 'send-3-receive', direction: 'receive', status: 'settled' })
    expect([sendHalf, plainReceive].filter(isReclaimRow)).toEqual([sendHalf])
  })
})

describe('getTypeLabel — the MEANS, for subtitles/search (signature unchanged)', () => {
  it('swap -> 스왑', () => {
    const tx = makeTx({ intent: 'swap' })
    expect(getTypeLabel(tx, t)).toBe('스왑')
  })

  it('lightning (bolt11) -> 라이트닝', () => {
    const tx = makeTx({ protocol: 'bolt11' })
    expect(getTypeLabel(tx, t)).toBe('라이트닝')
  })

  it('nutzap (cashu-token + nutzap intent) -> NutZap', () => {
    const tx = makeTx({ protocol: 'cashu-token', intent: 'nutzap' })
    expect(getTypeLabel(tx, t)).toBe('NutZap')
  })

  it('ecash (nut18) -> 이캐시', () => {
    const tx = makeTx({ protocol: 'nut18' })
    expect(getTypeLabel(tx, t)).toBe('이캐시')
  })

  it('is unaffected by pending/reclaimed act state — always the means', () => {
    const tx = makeTx({
      direction: 'send',
      status: 'settled',
      outcome: 'reclaimed',
      protocol: 'nut18',
    })
    expect(getTypeLabel(tx, t)).toBe('이캐시')
  })
})
