export type FlowTarget = 'send' | 'receive'

export function resolveFlowTarget(inputType: string): FlowTarget {
  switch (inputType) {
    case 'cashu-token':
    case 'lnurl-withdraw':
      return 'receive'
    case 'bolt11':
    case 'cashu-request':
    case 'lnurl-pay':
    case 'email-address':
    default:
      return 'send'
  }
}
