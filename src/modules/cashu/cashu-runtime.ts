import type { Manager } from '@cashu/coco-core'
import {
  enableWatchers,
  getCocoManager,
  recheckPendingMintQuotes,
  suspendWatchers,
} from './internal/coco-sdk'

interface KeyRingPair {
  publicKeyHex: string
  secretKey?: Uint8Array
}

interface KeyRingApi {
  generateKeyPair(dumpSecretKey?: boolean): Promise<KeyRingPair>
  addKeyPair(secretKey: Uint8Array): Promise<KeyRingPair>
  getLatestKeyPair(): Promise<KeyRingPair | null>
}

export type CashuRuntimeManager = Pick<Manager, 'on' | 'resumeSubscriptions' | 'pauseSubscriptions'>

export async function getCashuRuntimeManager(): Promise<CashuRuntimeManager> {
  return getCocoManager()
}

export async function getCashuKeyring(): Promise<KeyRingApi> {
  const manager = await getCocoManager()
  return manager.keyring as KeyRingApi
}

export async function enableCashuWatchers(): Promise<void> {
  await enableWatchers()
}

export async function recheckCashuPendingMintQuotes(): Promise<void> {
  await recheckPendingMintQuotes()
}

export async function resumeCashuSubscriptions(): Promise<void> {
  const manager = await getCocoManager()
  manager.resumeSubscriptions()
}

export async function pauseCashuSubscriptions(): Promise<void> {
  const manager = await getCocoManager()
  manager.pauseSubscriptions()
  // Coco pause는 mintOperationWatcher를 끄지만 resume은 되살리지 않는다
  // (init 시 disabled:true 구성) — 플래그를 동기화해야 resume의
  // enableCashuWatchers()가 재활성한다 (4단계 리뷰 #2)
  suspendWatchers()
}
