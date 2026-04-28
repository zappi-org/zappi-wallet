import { DisabledCustomerSupportChannel } from '@/adapters/customer-support/disabled-customer-support-channel.adapter'
import { DerivedCustomerSupportKeyProvider } from '@/adapters/customer-support/derived-customer-support-key-provider'
import { NostrCsCustomerSupportAdapter } from '@/adapters/customer-support/nostr-cs-customer-support.adapter'
import { BlossomAttachmentStoreAdapter } from '@/adapters/customer-support/blossom-attachment-store.adapter'
import { readCustomerSupportConfig } from '@/adapters/customer-support/customer-support-config'
import { DexieCustomerSupportHistoryStore } from '@/adapters/storage/dexie/dexie-customer-support-history.store'
import { SupportService } from '@/core/services/support.service'
import type { SupportUseCase } from '@/core/ports/driving/support.usecase'

export interface CreateSupportServiceDeps {
  bip39Seed: Uint8Array
}

export function createSupportService(deps: CreateSupportServiceDeps): SupportUseCase {
  const config = readCustomerSupportConfig()
  if (!config.ok) {
    return new SupportService(new DisabledCustomerSupportChannel(config.reason))
  }

  const keyProvider = new DerivedCustomerSupportKeyProvider(deps.bip39Seed)
  const historyStore = new DexieCustomerSupportHistoryStore()
  const attachmentStore = new BlossomAttachmentStoreAdapter(config.value.attachments.servers)
  return new SupportService(
    new NostrCsCustomerSupportAdapter(config.value, keyProvider, historyStore, attachmentStore),
  )
}
