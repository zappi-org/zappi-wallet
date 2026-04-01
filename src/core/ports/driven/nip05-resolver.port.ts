export interface Nip05Result {
  pubkey: string
  relays: string[]
}

export interface Nip05Resolver {
  resolve(address: string): Promise<Nip05Result | null>
}
