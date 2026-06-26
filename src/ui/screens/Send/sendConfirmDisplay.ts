import { PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from './SendFlow'

export interface ConfirmDisplayInfo {
  method: string
  recipient: string
  recipientDetail: string
  memo?: string
}

export function getConfirmDisplayInfo(
  data: SendableValidatedData,
  route: PaymentRoute | undefined,
  t: (key: string) => string,
  displayName?: string,
): ConfirmDisplayInfo {
  // Route-aware: unified QR에서 LN 라우트가 선택되면 lightning invoice 기반 표시
  const isLnRoute = route === PaymentRoute.LN_INTERNAL || route === PaymentRoute.LN_CROSS_MINT || route === PaymentRoute.MELT_TO_LN
  const isTokenRoute = route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.OWN_MINT_TOKEN || route === PaymentRoute.MINT_AND_DM

  if (isLnRoute && data.type === 'cashu-request' && data.parsed.lightningInvoice) {
    const inv = data.parsed.lightningInvoice
    return {
      method: 'Lightning',
      recipient: t('send.confirm.lightningInvoice'),
      recipientDetail: `${inv.slice(0, 12).toLowerCase()}...${inv.slice(-4).toLowerCase()}`,
      memo: data.parsed.description,
    }
  }

  if (isTokenRoute && data.type === 'cashu-request') {
    const req = data.request
    return {
      method: 'eCash',
      recipient: displayName || t('send.confirm.ecashRequest'),
      recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
      memo: data.parsed.description,
    }
  }

  switch (data.type) {
    case 'bolt11': {
      const inv = data.invoice
      return {
        method: 'Lightning',
        recipient: t('send.confirm.lightningInvoice'),
        recipientDetail: `${inv.slice(0, 8)}...${inv.slice(-4)}`,
        memo: data.description,
      }
    }
    case 'lightning-address':
      return {
        method: 'Lightning',
        recipient: displayName || data.address,
        recipientDetail: data.address,
      }
    case 'lnurl-pay':
      return {
        method: 'Lightning',
        recipient: data.params?.domain || 'LNURL',
        recipientDetail: data.params?.domain || 'LNURL',
      }
    case 'cashu-request': {
      // fallback (route 없을 때)
      const req = data.request
      return {
        method: 'eCash',
        recipient: displayName || t('send.confirm.ecashRequest'),
        recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
        memo: data.parsed.description,
      }
    }
    case 'my-wallet':
      return {
        method: t('send.confirm.internalTransfer'),
        recipient: data.targetMintName,
        recipientDetail: `${data.targetMintUrl.slice(0, 20)}...`,
      }
  }
}
