import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  buildPayoutScript,
  MAX_LOCKTIME_DELTA,
  MIN_LOCKTIME_DELTA,
  parsePayoutScript,
  payoutScriptAddress,
  verifyServerPayoutScript,
} from '@/adapters/onchain-payout/electrum/payout-script'
import type { PayoutNetwork } from '@/adapters/onchain-payout/electrum/network'

interface ScriptVector {
  network: PayoutNetwork
  locktime: number
  payment_hash: string
  preimage: string
  refund_pubkey: string
  claim_pubkey: string
  redeem_script: string
  lockup_address: string
  script_ripemd160: string
}

interface Vectors {
  swap_scripts: ScriptVector[]
}

const vectors: Vectors = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/vectors.json', 'utf8'),
)

describe('payout script', () => {
  it.each(vectors.swap_scripts)(
    'matches the vector for $network locktime $locktime',
    (vector) => {
      const paymentHash = hexToBytes(vector.payment_hash)
      const script = buildPayoutScript({
        paymentHash,
        claimPubkey: hexToBytes(vector.claim_pubkey),
        refundPubkey: hexToBytes(vector.refund_pubkey),
        locktime: vector.locktime,
      })

      expect(bytesToHex(script)).toBe(vector.redeem_script)
      expect(bytesToHex(ripemd160(paymentHash))).toBe(vector.script_ripemd160)
      expect(payoutScriptAddress(script, vector.network)).toBe(vector.lockup_address)

      const parsed = parsePayoutScript(script)
      expect(parsed).not.toBeNull()
      expect(bytesToHex(parsed?.hash160 ?? new Uint8Array())).toBe(vector.script_ripemd160)
      expect(bytesToHex(parsed?.claimPubkey ?? new Uint8Array())).toBe(vector.claim_pubkey)
      expect(bytesToHex(parsed?.refundPubkey ?? new Uint8Array())).toBe(vector.refund_pubkey)
      expect(parsed?.locktime).toBe(vector.locktime)
    },
  )

  it('parses no other script', () => {
    expect(parsePayoutScript(new Uint8Array([0x51]))).toBeNull()
    expect(parsePayoutScript(new Uint8Array())).toBeNull()
    expect(parsePayoutScript(hexToBytes('6a'))).toBeNull()
  })
})

describe('server payout script verification', () => {
  const vector = vectors.swap_scripts[1]
  const paymentHash = hexToBytes(vector.payment_hash)
  const claimPubkey = hexToBytes(vector.claim_pubkey)
  const script = hexToBytes(vector.redeem_script)
  const currentHeight = vector.locktime - 100

  function verify(patch: Partial<Parameters<typeof verifyServerPayoutScript>[0]> = {}) {
    return verifyServerPayoutScript({
      script,
      expectedPaymentHash: paymentHash,
      expectedClaimPubkey: claimPubkey,
      expectedLocktime: vector.locktime,
      expectedAddress: vector.lockup_address,
      currentHeight,
      network: vector.network,
      ...patch,
    })
  }

  it('accepts the server script and returns the refund key', () => {
    const result = verify()
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.refundPubkey).toBe(vector.refund_pubkey)
  })

  it('rejects a different claim pubkey', () => {
    const other = hexToBytes(vectors.swap_scripts[0].refund_pubkey)
    expect(verify({ expectedClaimPubkey: other }).ok).toBe(false)
  })

  it('rejects a different locktime', () => {
    expect(verify({ expectedLocktime: vector.locktime + 1 }).ok).toBe(false)
  })

  it('rejects a different payment hash', () => {
    expect(verify({ expectedPaymentHash: sha256(new Uint8Array([1])) }).ok).toBe(false)
  })

  it('rejects a mismatching address', () => {
    expect(verify({ expectedAddress: vectors.swap_scripts[0].lockup_address }).ok).toBe(false)
  })

  it('rejects an appended byte', () => {
    const extended = new Uint8Array(script.length + 1)
    extended.set(script)
    expect(verify({ script: extended }).ok).toBe(false)
  })

  it('rejects a script that is not the expected template', () => {
    expect(verify({ script: new Uint8Array([0x51]) }).ok).toBe(false)
  })

  it('rejects a timestamp locktime', () => {
    const timestampScript = buildPayoutScript({
      paymentHash,
      claimPubkey,
      refundPubkey: hexToBytes(vector.refund_pubkey),
      locktime: 500000001,
    })
    const result = verify({
      script: timestampScript,
      expectedLocktime: 500000001,
      currentHeight: 499999990,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a locktime only 60 blocks ahead', () => {
    expect(verify({ currentHeight: vector.locktime - MIN_LOCKTIME_DELTA }).ok).toBe(false)
  })

  it('accepts a locktime 61 blocks ahead', () => {
    expect(verify({ currentHeight: vector.locktime - MIN_LOCKTIME_DELTA - 1 }).ok).toBe(true)
  })

  it('accepts a locktime 100 blocks ahead', () => {
    expect(verify({ currentHeight: vector.locktime - MAX_LOCKTIME_DELTA }).ok).toBe(true)
  })

  it('rejects a locktime 101 blocks ahead', () => {
    expect(verify({ currentHeight: vector.locktime - MAX_LOCKTIME_DELTA - 1 }).ok).toBe(false)
  })
})
