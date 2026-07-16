/**
 * Onboarding assembly — moves App.tsx's direct adapter wiring into composition.
 *
 * App.tsx must stay lightweight: the static imports here are the same set as App.tsx's
 * former static imports (chunk graph unchanged), and NostrGateway/Profile are imported
 * dynamically only on onboarding completion (as in the original).
 */

import { CocoP2PKKeyManager } from '@/adapters/crypto/p2pk-key-manager.adapter'
import { getCocoManager } from '@/modules/cashu'
import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { createSecurityService } from './security'

/** Lightweight services for app-shell (App.tsx) init — used for unlock/onboarding decisions and completion wiring */
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
 * Wires the profile service at onboarding completion — the heavy Nostr gateway is
 * dynamically loaded only here, and ProfileService is assembled with a gateway
 * connected to the relays.
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
