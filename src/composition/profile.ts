/**
 * Composition root for ProfileUseCase
 */

import { Nip05ResolverAdapter } from '@/adapters/nip05/nip05-resolver'
import { ProfileService } from '@/core/services/profile.service'
import type { ProfileUseCase } from '@/core/ports/driving/profile.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

interface SettingsAccess {
  getSettings(): Promise<{ mints: string[]; relays: string[] }>
  saveSettings(settings: { mints: string[]; relays: string[] }): Promise<void>
}

export function createProfileService(
  nostrGateway: Pick<NostrGateway, 'publish' | 'queryEvents'>,
  settingsRepo: SettingsAccess,
): ProfileUseCase {
  return new ProfileService(
    nostrGateway,
    settingsRepo,
    new Nip05ResolverAdapter(),
  )
}
