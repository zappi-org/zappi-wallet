/**
 * Onboarding assembly — moves App.tsx's direct adapter wiring into composition.
 *
 * App.tsx must stay lightweight, so nothing here may statically reach the Cashu SDK or
 * the Nostr gateway: the Coco keyring is imported inside its getter and
 * NostrGateway/Profile only on onboarding completion.
 */

import { CocoP2PKKeyManager } from '@/adapters/crypto/p2pk-key-manager.adapter'
import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { createSecurityService } from './security'

/** Lightweight services for app-shell (App.tsx) init — used for unlock/onboarding decisions and completion wiring */
export function createOnboardingServices() {
  const security = createSecurityService()
  return {
    security,
    settingsRepo: new SettingsRepository(),
    // Loaded inside the getter, not at module scope: coco-sdk statically imports the
    // Cashu SDK, and the keyring is only reached after the user has a wallet — a
    // static import would download ~142 KB gzip of SDK before the lock screen paints.
    p2pkKeyManager: new CocoP2PKKeyManager(async () => {
      const { getCocoManager } = await import('@/modules/cashu/internal/coco-sdk')
      return (await getCocoManager()).keyring
    }),
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
