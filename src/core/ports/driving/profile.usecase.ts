export interface RecoveredProfile {
  mints: string[]
  relays: string[]
  p2pkPubkey?: string
}

export interface ZSConfiguration {
  relays: string[]
  mints: string[]
}

export interface ProfileUseCase {
  publishAll(
    pubkey: string,
    mints: string[],
    relays: string[],
    p2pkPubkey?: string,
    dmRelays?: string[],
  ): Promise<void>

  publishNutZapInfo(
    pubkey: string,
    mints: string[],
    p2pkPubkey?: string,
    relays?: string[],
  ): Promise<void>

  recoverProfile(pubkey: string): Promise<RecoveredProfile | null>

  fetchZSConfiguration(zsDomain: string): Promise<ZSConfiguration | null>

  saveProfileSettings(mints: string[], relays: string[]): Promise<void>
}
