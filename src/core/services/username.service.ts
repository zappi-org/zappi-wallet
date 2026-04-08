import type { UsernameUseCase } from '@/core/ports/driving/username.usecase'
import type { LightningAddressProvider } from '@/core/ports/driven/lightning-address.port'

export class UsernameService implements UsernameUseCase {
  constructor(private readonly provider: LightningAddressProvider) {}

  checkUsername(username: string) {
    return this.provider.checkUsername(username)
  }

  changeUsername(nostrPrivkey: string, username: string, cashuToken: string) {
    return this.provider.changeUsername(nostrPrivkey, username, cashuToken)
  }

  registerAddress(nostrPrivkey: string) {
    return this.provider.registerAddress(nostrPrivkey)
  }

  getAddress(pubkey: string) {
    return this.provider.getAddress(pubkey)
  }

  getDefaults() {
    return this.provider.getDefaults()
  }
}
