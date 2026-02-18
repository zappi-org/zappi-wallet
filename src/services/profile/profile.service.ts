import { NostrService, type NutZapInfo } from '@/services/nostr/nostr.service'
import { Nip05Service } from '@/services/nip05/nip05.service'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { ok, err, type Result } from '@/core/types'
import { Nip05LookupError, type BaseError } from '@/core/errors'
import { NOSTR_KINDS, DEFAULT_RELAYS, ZS_DOMAIN } from '@/core/constants'

/**
 * ZS configuration fetched from NIP-05 + kind:10019
 */
export interface ZSConfiguration {
  relays: string[]
  mints: string[]
}

/**
 * Recovered profile settings from Nostr
 */
export interface RecoveredProfile {
  mints: string[]
  relays: string[]
  p2pkPubkey?: string
}

/**
 * Result of publishing profile
 */
export interface PublishResult {
  eventId: string
  publishedTo: string[]
}

/**
 * Options for updating profile
 */
export interface UpdateProfileOptions {
  mints?: string[]
  p2pkPubkey?: string
  relays?: string[]
  publishRelays: string[]
}

/**
 * Service for managing Nostr profile (kind 10019, 10002)
 */
export class ProfileService {
  private nostrService: NostrService
  private nip05Service: Nip05Service
  private settingsRepo: SettingsRepository

  constructor() {
    this.nostrService = new NostrService()
    this.nip05Service = new Nip05Service()
    this.settingsRepo = new SettingsRepository()
  }

  /**
   * Get ZS relays from NIP-05 lookup, fallback to DEFAULT_RELAYS
   * TODO: When ZS domain is configured, this will query the ZS server
   */
  async getZSRelays(): Promise<string[]> {
    // If ZS_DOMAIN is not configured, use default relays
    if (!ZS_DOMAIN) {
      console.log('[ProfileService] ZS_DOMAIN not configured, using DEFAULT_RELAYS')
      return [...DEFAULT_RELAYS]
    }

    try {
      console.log('[ProfileService] Looking up ZS relays from:', ZS_DOMAIN)
      const lookupResult = await this.nip05Service.lookupRelaysOnly(ZS_DOMAIN)

      if (lookupResult.isOk() && lookupResult.value.length > 0) {
        console.log('[ProfileService] Found ZS relays:', lookupResult.value)
        return lookupResult.value
      }

      console.log('[ProfileService] No ZS relays found, using DEFAULT_RELAYS')
      return [...DEFAULT_RELAYS]
    } catch (error) {
      console.error('[ProfileService] Failed to lookup ZS relays:', error)
      return [...DEFAULT_RELAYS]
    }
  }

  /**
   * Fetch ZS configuration: NIP-05 → relays + pubkey → kind:10019 → mints
   * Used during initial wallet creation to discover mints and relays from ZS
   * Returns null if ZS_DOMAIN is not configured or lookup fails
   */
  async fetchZSConfiguration(): Promise<ZSConfiguration | null> {
    if (!ZS_DOMAIN) {
      console.log('[ProfileService] ZS_DOMAIN not configured, skipping ZS configuration fetch')
      return null
    }

    try {
      // Step 1: NIP-05 lookup to get ZS pubkey + relays
      console.log('[ProfileService] Looking up ZS NIP-05:', ZS_DOMAIN)
      const lookupResult = await this.nip05Service.lookup(`_@${ZS_DOMAIN}`)

      if (lookupResult.isErr()) {
        console.error('[ProfileService] ZS NIP-05 lookup failed:', lookupResult.error)
        return null
      }

      const { pubkey: zsPubkey, relays: zsRelays } = lookupResult.value
      if (zsRelays.length === 0) {
        console.error('[ProfileService] ZS NIP-05 returned no relays')
        return null
      }

      console.log('[ProfileService] ZS pubkey:', zsPubkey)
      console.log('[ProfileService] ZS relays:', zsRelays)

      // Step 2: Fetch ZS's kind:10019 from those relays
      const nutzapInfo = await this.fetchNutzapInfo(zsPubkey, zsRelays)
      if (!nutzapInfo || nutzapInfo.mints.length === 0) {
        console.error('[ProfileService] ZS kind:10019 not found or has no mints')
        return null
      }

      console.log('[ProfileService] ZS mints:', nutzapInfo.mints)

      return {
        relays: zsRelays,
        mints: nutzapInfo.mints,
      }
    } catch (error) {
      console.error('[ProfileService] Failed to fetch ZS configuration:', error)
      return null
    }
  }

  /**
   * Publish NutZap info (kind 10019)
   * Contains mints and P2PK pubkey for receiving NutZaps
   */
  async publishNutzapInfo(
    privateKeyHex: string,
    mints: string[],
    p2pkPubkey: string,
    publishRelays: string[],
    dmRelays?: string[]
  ): Promise<Result<PublishResult, BaseError>> {
    // Create kind 10019 event
    const event = this.nostrService.createKind10019Event(
      privateKeyHex,
      mints,
      p2pkPubkey,
      dmRelays
    )

    // Publish to relays
    const publishResult = await this.nostrService.publish(event, publishRelays)
    if (publishResult.isErr()) {
      return err(publishResult.error)
    }

    return ok({
      eventId: event.id,
      publishedTo: publishResult.value,
    })
  }

  /**
   * Publish relay list (kind 10002)
   * Contains relays for receiving DMs
   */
  async publishRelayList(
    privateKeyHex: string,
    relays: string[],
    publishRelays: string[]
  ): Promise<Result<PublishResult, BaseError>> {
    // Create kind 10002 event
    const event = this.nostrService.createKind10002Event(privateKeyHex, relays)

    // Publish to relays
    const publishResult = await this.nostrService.publish(event, publishRelays)
    if (publishResult.isErr()) {
      return err(publishResult.error)
    }

    return ok({
      eventId: event.id,
      publishedTo: publishResult.value,
    })
  }

  /**
   * Publish DM relay list (kind 10050) for NIP-17
   * This tells other clients where to send encrypted DMs
   */
  async publishDMRelayList(
    privateKeyHex: string,
    relays: string[],
    publishRelays: string[]
  ): Promise<Result<PublishResult, BaseError>> {
    // Create kind 10050 event
    const event = this.nostrService.createKind10050Event(privateKeyHex, relays)

    // Publish to relays
    const publishResult = await this.nostrService.publish(event, publishRelays)
    if (publishResult.isErr()) {
      return err(publishResult.error)
    }

    return ok({
      eventId: event.id,
      publishedTo: publishResult.value,
    })
  }

  /**
   * Lookup ZS domain NIP-05 and publish both events to those relays
   */
  async publishToZSRelays(
    privateKeyHex: string,
    zsDomain: string,
    mints: string[],
    p2pkPubkey: string,
    dmRelays: string[]
  ): Promise<Result<{ nutzapInfo: PublishResult; relayList: PublishResult }, BaseError>> {
    // Lookup ZS relays
    const lookupResult = await this.nip05Service.lookupRelaysOnly(zsDomain)
    if (lookupResult.isErr()) {
      return err(lookupResult.error)
    }

    const zsRelays = lookupResult.value
    if (zsRelays.length === 0) {
      return err(new Nip05LookupError(zsDomain))
    }

    // Publish NutZap info (kind 10019) to ZS relays
    const nutzapResult = await this.publishNutzapInfo(
      privateKeyHex,
      mints,
      p2pkPubkey,
      zsRelays,
      dmRelays
    )
    if (nutzapResult.isErr()) {
      return err(nutzapResult.error)
    }

    // Publish relay list (kind 10002) to ZS relays
    const relayListResult = await this.publishRelayList(
      privateKeyHex,
      dmRelays,
      zsRelays
    )
    if (relayListResult.isErr()) {
      return err(relayListResult.error)
    }

    return ok({
      nutzapInfo: nutzapResult.value,
      relayList: relayListResult.value,
    })
  }

  /**
   * Update profile with new mints or relays
   */
  async updateProfile(
    privateKeyHex: string,
    options: UpdateProfileOptions
  ): Promise<Result<{ published: PublishResult[] }, BaseError>> {
    const published: PublishResult[] = []

    // Publish updated NutZap info if mints changed
    if (options.mints && options.p2pkPubkey) {
      const nutzapResult = await this.publishNutzapInfo(
        privateKeyHex,
        options.mints,
        options.p2pkPubkey,
        options.publishRelays
      )
      if (nutzapResult.isErr()) {
        return err(nutzapResult.error)
      }
      published.push(nutzapResult.value)
    }

    // Publish updated relay list if relays changed
    if (options.relays) {
      const relayResult = await this.publishRelayList(
        privateKeyHex,
        options.relays,
        options.publishRelays
      )
      if (relayResult.isErr()) {
        return err(relayResult.error)
      }
      published.push(relayResult.value)
    }

    return ok({ published })
  }

  /**
   * Save profile settings locally
   */
  async saveProfileSettings(
    mints: string[],
    relays: string[],
    lightningAddress?: string
  ): Promise<void> {
    const settings = await this.settingsRepo.getSettings()
    await this.settingsRepo.saveSettings({
      ...settings,
      mints,
      relays,
      lightningAddress,
    })
  }

  /**
   * Fetch NutZap info (kind 10019) for a pubkey from relays
   * Used during wallet recovery to get mint/relay lists
   */
  async fetchNutzapInfo(
    pubkey: string,
    relays?: string[]
  ): Promise<NutZapInfo | null> {
    const queryRelays = relays ?? [...DEFAULT_RELAYS]

    try {
      const event = await this.nostrService.queryEvent(queryRelays, {
        kinds: [NOSTR_KINDS.NUTZAP_INFO],
        authors: [pubkey],
      })

      if (!event) {
        console.log('[ProfileService] No kind 10019 event found for pubkey:', pubkey)
        return null
      }

      const nutzapInfo = this.nostrService.parseNutZapInfo(event)
      console.log('[ProfileService] Found NutZap info:', nutzapInfo)
      return nutzapInfo
    } catch (error) {
      console.error('[ProfileService] Failed to fetch NutZap info:', error)
      return null
    }
  }

  /**
   * Fetch relay list (kind 10002) for a pubkey from relays
   * Used during wallet recovery to get relay lists
   */
  async fetchRelayList(
    pubkey: string,
    relays?: string[]
  ): Promise<string[]> {
    const queryRelays = relays ?? [...DEFAULT_RELAYS]

    try {
      const event = await this.nostrService.queryEvent(queryRelays, {
        kinds: [NOSTR_KINDS.RELAY_LIST],
        authors: [pubkey],
      })

      if (!event) {
        console.log('[ProfileService] No kind 10002 event found for pubkey:', pubkey)
        return []
      }

      const relayList = this.nostrService.parseRelayList(event)
      console.log('[ProfileService] Found relay list:', relayList)
      return relayList
    } catch (error) {
      console.error('[ProfileService] Failed to fetch relay list:', error)
      return []
    }
  }

  /**
   * Recover profile settings from Nostr
   * Fetches both kind 10019 and kind 10002 for a pubkey
   * Uses ZS relays if configured, otherwise DEFAULT_RELAYS
   */
  async recoverProfileFromNostr(
    pubkey: string,
    queryRelays?: string[]
  ): Promise<RecoveredProfile | null> {
    console.log('[ProfileService] Recovering profile for pubkey:', pubkey)

    // Get relays to query from (ZS relays or default)
    const relaysToQuery = queryRelays ?? await this.getZSRelays()
    console.log('[ProfileService] Querying relays:', relaysToQuery)

    // Fetch NutZap info (mints, p2pk pubkey)
    const nutzapInfo = await this.fetchNutzapInfo(pubkey, relaysToQuery)
    if (!nutzapInfo || nutzapInfo.mints.length === 0) {
      console.log('[ProfileService] No mints found in NutZap info')
      return null
    }

    // Fetch relay list
    const relayList = await this.fetchRelayList(pubkey, relaysToQuery)
    // Use relays from 10019 if 10002 is empty
    const relays = relayList.length > 0 ? relayList : (nutzapInfo.relays ?? [])

    return {
      mints: nutzapInfo.mints,
      relays,
      p2pkPubkey: nutzapInfo.p2pkPubkey,
    }
  }

  /**
   * Publish profile to Nostr (kind 10019, 10002, and 10050)
   * Uses ZS relays if configured, otherwise DEFAULT_RELAYS
   * Called on wallet creation to announce wallet configuration
   */
  async publishProfile(
    privateKeyHex: string,
    mints: string[],
    p2pkPubkey: string,
    dmRelays: string[],
    targetRelays?: string[]
  ): Promise<Result<{ nutzapInfo: PublishResult; relayList: PublishResult; dmRelayList: PublishResult }, BaseError>> {
    // Use provided relays or fetch ZS relays
    const publishRelays = targetRelays ?? await this.getZSRelays()
    console.log('[ProfileService] Publishing profile to relays:', publishRelays)

    // Publish NutZap info (kind 10019)
    const nutzapResult = await this.publishNutzapInfo(
      privateKeyHex,
      mints,
      p2pkPubkey,
      publishRelays,
      dmRelays
    )
    if (nutzapResult.isErr()) {
      console.error('[ProfileService] Failed to publish NutZap info:', nutzapResult.error)
      return err(nutzapResult.error)
    }
    console.log('[ProfileService] Published kind 10019:', nutzapResult.value.eventId)

    // Publish relay list (kind 10002)
    const relayListResult = await this.publishRelayList(
      privateKeyHex,
      dmRelays,
      publishRelays
    )
    if (relayListResult.isErr()) {
      console.error('[ProfileService] Failed to publish relay list:', relayListResult.error)
      return err(relayListResult.error)
    }
    console.log('[ProfileService] Published kind 10002:', relayListResult.value.eventId)

    // Publish DM relay list (kind 10050) for NIP-17 compatibility
    const dmRelayListResult = await this.publishDMRelayList(
      privateKeyHex,
      dmRelays,
      publishRelays
    )
    if (dmRelayListResult.isErr()) {
      console.error('[ProfileService] Failed to publish DM relay list:', dmRelayListResult.error)
      return err(dmRelayListResult.error)
    }
    console.log('[ProfileService] Published kind 10050:', dmRelayListResult.value.eventId)

    return ok({
      nutzapInfo: nutzapResult.value,
      relayList: relayListResult.value,
      dmRelayList: dmRelayListResult.value,
    })
  }
}
