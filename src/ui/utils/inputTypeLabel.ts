const INPUT_TYPE_LABELS: Record<string, string> = {
  'bolt11': 'Bolt11',
  'lightning-address': 'Lightning Address',
  'lnurl': 'LNURL',
  'lnurl-pay': 'LNURL Pay',
  'cashu-request': 'Cashu Request',
  'cashu-token': 'Cashu Token',
  'lightning': 'Lightning',
  'my-wallet': 'My Wallet',
}

export function getInputTypeLabel(type: string): string {
  return INPUT_TYPE_LABELS[type] ?? type
}
