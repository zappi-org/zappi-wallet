import type { SendableValidatedData } from './SendFlow'

function getDirectNostrRecipientTarget(data: SendableValidatedData): string | null {
  if (data.type !== 'cashu-request') return null
  const target = data.parsed.nostrTarget?.trim()
  const request = data.request.trim()
  const normalizedTarget = target?.toLowerCase()
  const normalizedRequest = request.toLowerCase()
  const isNostrTarget = normalizedTarget?.startsWith('npub1') || normalizedTarget?.startsWith('nprofile1')
  const isNostrRequest = normalizedRequest.startsWith('npub1') || normalizedRequest.startsWith('nprofile1')

  if (data.parsed.sameMintOnly !== true || (!isNostrTarget && !isNostrRequest)) {
    return null
  }

  return target || request
}

export function isDirectNostrCashuRequest(data: SendableValidatedData): boolean {
  return getDirectNostrRecipientTarget(data) !== null
}

export function getDirectNostrDisplayTarget(data: SendableValidatedData): string | null {
  return getDirectNostrRecipientTarget(data)
}

export function formatDirectNostrRecipient(value: string): string {
  const text = value.trim()
  if (text.length <= 20) return text
  return `${text.slice(0, 8)}...${text.slice(-4)}`
}

export function getDestinationDisplay(data: SendableValidatedData, displayName?: string): string {
  if (displayName) return displayName

  switch (data.type) {
    case 'bolt11':
      return data.description || 'Lightning'
    case 'lightning-address':
      return data.address.includes('@') ? data.address.split('@')[0] : data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request': {
      const directTarget = getDirectNostrRecipientTarget(data)
      return directTarget ? formatDirectNostrRecipient(directTarget) : 'eCash'
    }
    case 'my-wallet':
      return data.targetMintName
  }
}

/**
 * Format npub for display: first8...mid4...last4
 */
export function formatNpubShort(npub: string): string {
  if (npub.length < 20) return npub
  const mid = Math.floor(npub.length / 2)
  return `${npub.slice(0, 8)}...${npub.slice(mid - 2, mid + 2)}...${npub.slice(-4)}`
}

/**
 * Look up contact name by address
 * @param findByAddress - ContactUseCase.findByAddress 또는 동등한 함수
 */
export async function findContactName(
  address: string,
  findByAddress: (addr: string) => Promise<{ name: string } | null>,
): Promise<string | null> {
  const contact = await findByAddress(address)
  return contact?.name || null
}
