/**
 * Onboarding 조립 — App.tsx(앱 셸)의 어댑터 직접 배선을 composition으로 이동 (R2-C).
 *
 * App.tsx는 경량 유지가 계약이다: 여기의 정적 import는 기존 App.tsx의 정적
 * import와 동일 집합(청크 그래프 불변)이고, NostrGateway/Profile은 온보딩
 * 완료 시점에만 동적 import한다 (원본과 동일).
 */

import { CocoP2PKKeyManager } from '@/adapters/crypto/p2pk-key-manager.adapter'
import { getCocoManager } from '@/modules/cashu'
import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { createSecurityService } from './security'

/** 앱 셸(App.tsx) 초기화용 경량 서비스 — unlock/온보딩 판정과 온보딩 완료 배선에 사용 */
export function createOnboardingServices() {
  const security = createSecurityService()
  return {
    security,
    settingsRepo: new SettingsRepository(),
    p2pkKeyManager: new CocoP2PKKeyManager(async () => (await getCocoManager()).keyring),
  }
}

export type OnboardingServices = ReturnType<typeof createOnboardingServices>

/**
 * 온보딩 완료 시점의 프로필 서비스 배선 — 무거운 Nostr 게이트웨이는 이때만
 * 동적 로드하고, relays에 연결된 게이트웨이로 ProfileService를 조립한다.
 */
export async function createOnboardingProfileService(params: {
  privateKeyHex: string
  relays: string[]
  settingsRepo: SettingsRepository
}) {
  const { NostrGatewayAdapter } = await import('@/adapters/nostr/nostr-gateway')
  const { createProfileService } = await import('./profile')
  const nostrGateway = new NostrGatewayAdapter({ privateKeyHex: params.privateKeyHex })
  await nostrGateway.connect(params.relays)
  return createProfileService(nostrGateway, params.settingsRepo)
}
