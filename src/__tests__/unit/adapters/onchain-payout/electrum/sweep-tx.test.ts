import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/hashes/utils.js'
import { buildSweepTx } from '@/adapters/onchain-payout/electrum/sweep-tx'
import type { PayoutNetwork } from '@/adapters/onchain-payout/electrum/network'

interface ClaimTxVector {
  network: PayoutNetwork
  funding_txid: string
  outpoint_n: number
  funding_value: number
  redeem_script: string
  claim_privkey: string
  preimage: string
  locktime: number
  dest_address: string
  dest_value: number
  nsequence: number
  claim_tx_hex: string
  claim_tx_txid: string
}

interface Vectors {
  claim_tx: ClaimTxVector
}

const vectors: Vectors = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/vectors.json', 'utf8'),
)

const claim = vectors.claim_tx

function build(patch: Partial<Parameters<typeof buildSweepTx>[0]> = {}) {
  return buildSweepTx({
    fundingTxId: claim.funding_txid,
    fundingVout: claim.outpoint_n,
    fundingValue: claim.funding_value,
    script: hexToBytes(claim.redeem_script),
    secret: hexToBytes(claim.preimage),
    claimSecretKey: hexToBytes(claim.claim_privkey),
    destination: claim.dest_address,
    fee: claim.funding_value - claim.dest_value,
    maxFee: claim.funding_value - claim.dest_value,
    fundingConfirmations: 1,
    network: claim.network,
    ...patch,
  })
}

describe('sweep transaction', () => {
  it('matches the vector byte for byte', () => {
    const tx = build()
    expect(tx.hex).toBe(claim.claim_tx_hex)
    expect(tx.txid).toBe(claim.claim_tx_txid)
    expect(Math.abs(tx.vsize - 136)).toBeLessThanOrEqual(1)
  })

  it('refuses to build a dust output', () => {
    expect(() => build({ fee: claim.funding_value - 329 })).toThrow()
  })

  it('refuses a zero fee', () => {
    expect(() => build({ fee: 0 })).toThrow()
  })

  it('refuses unconfirmed funding', () => {
    expect(() => build({ fundingConfirmations: 0 })).toThrow()
  })

  it('refuses a fee above the maximum', () => {
    expect(() => build({ maxFee: claim.funding_value - claim.dest_value - 1 })).toThrow()
  })

  it('refuses a short secret', () => {
    expect(() => build({ secret: hexToBytes(claim.preimage).slice(0, 31) })).toThrow()
  })

  it('refuses a secret that does not match the script', () => {
    expect(() => build({ secret: hexToBytes('22'.repeat(32)) })).toThrow()
  })

  it('refuses a claim key that does not match the script', () => {
    expect(() => build({ claimSecretKey: hexToBytes('44'.repeat(32)) })).toThrow()
  })

  it('refuses a script that is not a payout script', () => {
    expect(() => build({ script: new Uint8Array([0x51]) })).toThrow()
  })
})
