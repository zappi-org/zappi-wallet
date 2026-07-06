import { mintUrlKey } from '@/utils/url'
import { validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import {
  CheckStateEnum,
  Mint,
  Wallet,
  getEncodedToken,
  type Proof,
} from '@cashu/cashu-ts'
import type {
  ExternalMnemonicRecoveryPort,
  ExternalMnemonicRecoveryResult,
  RecoveredEcashToken,
} from '@/core/ports/driven/external-mnemonic-recovery.port'

const RESTORE_BATCH_SIZE = 100
const RESTORE_GAP_LIMIT = 300
const SUPPORTED_UNIT = 'sat'

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(' ')
}

function proofAmount(proof: Proof): number {
  return Number(proof.amount)
}

function proofSecret(proof: Proof): string {
  return String(proof.secret)
}

async function restoreMintTokens(
  mintUrl: string,
  bip39Seed: Uint8Array,
): Promise<RecoveredEcashToken[]> {
  const mint = new Mint(mintUrl)
  const { keysets } = await mint.getKeySets()
  const restoredBySecret = new Map<string, Proof>()

  for (const keyset of keysets) {
    if (keyset.unit !== SUPPORTED_UNIT) continue

    const wallet = new Wallet(mint, {
      bip39seed: bip39Seed,
      unit: keyset.unit,
    })
    await wallet.loadMint()

    const { proofs } = await wallet.batchRestore(RESTORE_GAP_LIMIT, RESTORE_BATCH_SIZE, 0, keyset.id)
    if (proofs.length === 0) continue

    const states = await wallet.checkProofsStates(proofs)
    for (let i = 0; i < proofs.length; i += 1) {
      if (states[i]?.state !== CheckStateEnum.UNSPENT) continue
      restoredBySecret.set(proofSecret(proofs[i]), proofs[i])
    }
  }

  const proofs = [...restoredBySecret.values()]
  if (proofs.length === 0) return []

  return [{
    mintUrl,
    token: getEncodedToken({ mint: mintUrl, unit: SUPPORTED_UNIT, proofs }),
    amount: proofs.reduce((sum, proof) => sum + proofAmount(proof), 0),
    proofCount: proofs.length,
  }]
}

export class CashuExternalMnemonicRecovery implements ExternalMnemonicRecoveryPort {
  async recoverTokens(params: {
    mnemonic: string
    mintUrls: string[]
    onProgress?: (progress: { mintUrl: string; index: number; total: number }) => void
  }): Promise<ExternalMnemonicRecoveryResult> {
    const mnemonic = normalizeMnemonic(params.mnemonic)
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Invalid mnemonic')
    }

    // dedup 은 비교 canonical(mintUrlKey)로 — 대소문자·:443 표기 변형이 같은 민트를
    // 두 번 복원(중복 네트워크 왕복)하지 않게 한다. 와이어 호출에는 첫 표기 원문을
    // 쓴다 (first-wins 루프 — Map 스프레드는 last-wins 라 주석과 어긋났었다).
    const byKey = new Map<string, string>()
    for (const url of params.mintUrls.map((u) => u.trim()).filter(Boolean)) {
      const key = mintUrlKey(url)
      if (!byKey.has(key)) byKey.set(key, url)
    }
    const uniqueMintUrls = [...byKey.values()]
    const bip39Seed = mnemonicToSeedSync(mnemonic)
    const tokens: RecoveredEcashToken[] = []
    const failedMints: { mintUrl: string; error: string }[] = []

    for (let i = 0; i < uniqueMintUrls.length; i += 1) {
      const mintUrl = uniqueMintUrls[i]
      params.onProgress?.({ mintUrl, index: i + 1, total: uniqueMintUrls.length })
      try {
        tokens.push(...await restoreMintTokens(mintUrl, bip39Seed))
      } catch (error) {
        failedMints.push({
          mintUrl,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      tokens,
      scannedMints: uniqueMintUrls.length,
      failedMints,
    }
  }
}

export function createExternalMnemonicRecovery(): ExternalMnemonicRecoveryPort {
  return new CashuExternalMnemonicRecovery()
}
