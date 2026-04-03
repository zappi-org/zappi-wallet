/**
 * ProfileService — ProfileUseCase 구현 (ZAP-144 → ZAP-160)
 *
 * 이벤트 조립은 domain/profile.ts 순수 함수.
 * 발행/조회는 NostrGateway 포트.
 * 설정 저장은 SettingsRepository 포트.
 * NIP-05 조회는 Nip05Resolver 포트.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { SettingsRepository } from '@/core/ports/driven/settings.repository.port'
import type { Nip05Resolver } from '@/core/ports/driven/nip05-resolver.port'
import type { ProfileUseCase, RecoveredProfile, ZSConfiguration } from '@/core/ports/driving/profile.usecase'
import type { NutZapInfo } from '@/core/domain/nutzap'
import { NOSTR_KINDS } from '@/core/constants'
import { parseNutZapInfo } from '@/core/domain/nutzap'
import {
  buildNutZapInfoEvent,
  buildRelayListEvent,
  buildDMRelayListEvent,
  parseRelayList,
} from '@/core/domain/profile'

export class ProfileService implements ProfileUseCase {
  constructor(
    private readonly nostr: Pick<NostrGateway, 'publish' | 'queryEvents'>,
    private readonly settings: Pick<SettingsRepository, 'getSettings' | 'saveSettings'>,
    private readonly nip05: Nip05Resolver,
  ) {}

  // ─── 발행 ───

  async publishNutZapInfo(
    pubkey: string,
    mints: string[],
    p2pkPubkey?: string,
    relays?: string[],
  ): Promise<void> {
    const event = buildNutZapInfoEvent(pubkey, mints, p2pkPubkey, relays)
    await this.nostr.publish(event)
  }

  async publishRelayList(pubkey: string, relays: string[]): Promise<void> {
    const event = buildRelayListEvent(pubkey, relays)
    await this.nostr.publish(event)
  }

  async publishDMRelayList(pubkey: string, relays: string[]): Promise<void> {
    const event = buildDMRelayListEvent(pubkey, relays)
    await this.nostr.publish(event)
  }

  async publishAll(
    pubkey: string,
    mints: string[],
    relays: string[],
    p2pkPubkey?: string,
    dmRelays?: string[],
  ): Promise<void> {
    await Promise.all([
      this.publishNutZapInfo(pubkey, mints, p2pkPubkey, relays),
      this.publishRelayList(pubkey, relays),
      this.publishDMRelayList(pubkey, dmRelays ?? relays),
    ])
  }

  // ─── 조회 ───

  async fetchNutZapInfo(pubkey: string): Promise<NutZapInfo | undefined> {
    const events = await this.nostr.queryEvents([
      { kinds: [NOSTR_KINDS.NUTZAP_INFO], authors: [pubkey], limit: 1 },
    ])
    if (events.length === 0) return undefined

    const info = parseNutZapInfo(events[0])
    if (info.mints.length === 0) return undefined
    return info
  }

  async fetchRelayList(pubkey: string): Promise<string[]> {
    const events = await this.nostr.queryEvents([
      { kinds: [NOSTR_KINDS.RELAY_LIST], authors: [pubkey], limit: 1 },
    ])
    if (events.length === 0) return []
    return parseRelayList(events[0])
  }

  // ─── 복구 ───

  async recoverProfile(pubkey: string): Promise<RecoveredProfile | null> {
    const nutzapInfo = await this.fetchNutZapInfo(pubkey)
    if (!nutzapInfo || nutzapInfo.mints.length === 0) return null

    const relayList = await this.fetchRelayList(pubkey)
    const relays = relayList.length > 0 ? relayList : (nutzapInfo.relays ?? [])

    return {
      mints: nutzapInfo.mints,
      relays,
      p2pkPubkey: nutzapInfo.p2pkPubkey,
    }
  }

  // ─── ZS 설정 ───

  async fetchZSConfiguration(zsDomain: string): Promise<ZSConfiguration | null> {
    if (!zsDomain) return null

    try {
      const nip05Result = await this.nip05.resolve(`_@${zsDomain}`)
      if (!nip05Result || nip05Result.relays.length === 0) return null

      const nutzapInfo = await this.fetchNutZapInfo(nip05Result.pubkey)
      if (!nutzapInfo || nutzapInfo.mints.length === 0) return null

      return {
        relays: nip05Result.relays,
        mints: nutzapInfo.mints,
      }
    } catch {
      return null
    }
  }

  // ─── 설정 저장 ───

  async saveProfileSettings(mints: string[], relays: string[]): Promise<void> {
    const current = await this.settings.getSettings()
    await this.settings.saveSettings({ ...current, mints, relays })
  }

  // ─── ZS relay 조회 ───

  async resolveRelaysFromNip05(address: string): Promise<string[]> {
    const result = await this.nip05.resolve(address)
    return result?.relays ?? []
  }
}
