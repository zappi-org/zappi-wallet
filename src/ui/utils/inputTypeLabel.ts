const INPUT_TYPE_LABELS: Record<string, string> = {
  'bolt11': 'Bolt11',
  'email-address': 'Lightning Address',
  'nostr-address': 'Nostr Address',
  'lnurl': 'LNURL',
  'lnurl-pay': 'LNURL Pay',
  'cashu-request': 'Cashu Request',
  'cashu-token': 'Cashu Token',
  'lightning': 'Lightning',
  'my-wallet': 'My Wallet',
  'npub': 'Nostr DM',
  'nprofile': 'Nostr DM',
}

export function getInputTypeLabel(type: string): string {
  return INPUT_TYPE_LABELS[type] ?? type
}
