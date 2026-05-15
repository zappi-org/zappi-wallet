import { describe, expect, it } from 'vitest'
import { sat } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import { getTitle, getTypeLabel, isNpubTransaction } from '@/ui/components/wallet/transactionHelpers'

const labels: Record<string, string> = {
  'history.npubReceive': '수신 (npub)',
  'history.npubSend': '전송 (npub)',
  'history.ecashRegister': '등록 (이캐시)',
  'history.ecashToken': '생성 (이캐시)',
}

const t = (key: string) => labels[key] ?? key

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    direction: 'receive',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(100),
    accountId: 'https://mint.test',
    status: 'settled',
    createdAt: 1,
    ...overrides,
  }
}

describe('transactionHelpers', () => {
  it('labels direct npub sends as npub sends', () => {
    const tx = makeTx({
      direction: 'send',
      metadata: {
        counterpartyAddress: 'npub1recipient',
        counterpartyAddressType: 'npub',
      },
    })

    expect(isNpubTransaction(tx)).toBe(true)
    expect(getTypeLabel(tx, t)).toBe('전송 (npub)')
    expect(getTitle(tx, t)).toBe('전송 (npub)')
  })

  it('labels gift-wrap receives from a Nostr pubkey as npub receives', () => {
    const tx = makeTx({
      metadata: {
        source: 'gift-wrap',
        counterpartyAddressType: 'npub',
        counterpartyPubkey: 'sender-pubkey',
      },
    })

    expect(isNpubTransaction(tx)).toBe(true)
    expect(getTypeLabel(tx, t)).toBe('수신 (npub)')
    expect(getTitle(tx, t)).toBe('수신 (npub)')
  })

  it('keeps normal ecash token labels when no npub metadata exists', () => {
    const tx = makeTx({})

    expect(isNpubTransaction(tx)).toBe(false)
    expect(getTypeLabel(tx, t)).toBe('등록 (이캐시)')
  })
})
