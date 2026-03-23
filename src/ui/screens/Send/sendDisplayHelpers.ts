import type { SendableValidatedData } from './SendFlow'

export function getDestinationDisplay(data: SendableValidatedData): string {
  switch (data.type) {
    case 'bolt11':
      return data.description || 'Lightning'
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request':
      return 'eCash'
    case 'my-wallet':
      return data.targetMintName
  }
}
