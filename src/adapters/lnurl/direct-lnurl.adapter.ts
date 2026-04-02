import { decode } from 'light-bolt11-decoder'
import type {
  LnurlGateway,
  LnurlResponse,
  LnurlPayParams,
  LnurlPayResult,
  LnurlWithdrawParams,
  LnurlWithdrawResult,
  LnurlAuthParams,
  LnurlAuthResult,
} from '@/core/ports/driven/lnurl-gateway.port'

export class DirectLnurlAdapter implements LnurlGateway {
  private readonly timeout: number

  constructor(options?: { timeout?: number }) {
    this.timeout = options?.timeout ?? 10_000
  }

  async fetchLnurl(url: string): Promise<LnurlResponse> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch LNURL: ${res.status}`)
    }

    const data = await res.json()
    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL endpoint returned error')
    }

    const domain = (() => {
      try { return new URL(data.callback ?? url).hostname } catch { return '' }
    })()

    switch (data.tag) {
      case 'payRequest':
        return {
          tag: 'payRequest',
          callback: data.callback,
          minSendable: data.minSendable,
          maxSendable: data.maxSendable,
          metadata: data.metadata,
          commentAllowed: data.commentAllowed,
          domain,
          allowsNostr: data.allowsNostr,
          nostrPubkey: data.nostrPubkey,
          payerData: data.payerData,
        }
      case 'withdrawRequest':
        return {
          tag: 'withdrawRequest',
          callback: data.callback,
          k1: data.k1,
          minWithdrawable: data.minWithdrawable,
          maxWithdrawable: data.maxWithdrawable,
          defaultDescription: data.defaultDescription ?? '',
          domain,
        }
      case 'login':
        return {
          tag: 'login',
          callback: data.callback,
          k1: data.k1,
          domain,
          action: data.action,
        }
      default:
        throw new Error(`Unknown LNURL tag: ${data.tag}`)
    }
  }

  async resolvePay(address: string): Promise<LnurlPayParams> {
    const parts = address.split('@')
    if (parts.length !== 2) throw new Error('Invalid Lightning Address')
    const [user, domain] = parts

    const protocol = domain.endsWith('.onion') ? 'http' : 'https'
    const url = `${protocol}://${domain}/.well-known/lnurlp/${user}`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to resolve Lightning Address: ${res.status}`)
    }

    const data = await res.json()

    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL-PAY endpoint returned error')
    }
    if (data.tag !== 'payRequest') {
      throw new Error(`Invalid LNURL tag: expected payRequest, got ${data.tag}`)
    }

    return {
      callback: data.callback,
      minSendable: data.minSendable,
      maxSendable: data.maxSendable,
      metadata: data.metadata,
      commentAllowed: data.commentAllowed,
      tag: data.tag,
      domain,
      allowsNostr: data.allowsNostr,
      nostrPubkey: data.nostrPubkey,
      payerData: data.payerData,
    }
  }

  async fetchInvoice(
    params: LnurlPayParams,
    amountSats: number,
    options?: { comment?: string },
  ): Promise<LnurlPayResult> {
    const amountMsat = Math.floor(amountSats * 1000)

    if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
      throw new Error(
        `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`,
      )
    }

    const url = new URL(params.callback)
    url.searchParams.set('amount', amountMsat.toString())

    if (
      options?.comment &&
      params.commentAllowed &&
      options.comment.length <= params.commentAllowed
    ) {
      url.searchParams.set('comment', options.comment)
    }

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch invoice: ${res.status}`)
    }

    const data = await res.json()
    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'Failed to fetch invoice')
    }
    if (!data.pr) {
      throw new Error('No payment request returned from LNURL service')
    }

    await this.verifyDescriptionHash(data.pr, params.metadata)

    return {
      bolt11: data.pr,
      successAction: data.successAction,
      verify: data.verify,
    }
  }

  // ── Withdraw — LUD-03 ──

  async parseWithdraw(url: string): Promise<LnurlWithdrawParams> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch withdraw params: ${res.status}`)
    }

    const data = await res.json()

    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL-withdraw endpoint returned error')
    }
    if (data.tag !== 'withdrawRequest') {
      throw new Error(`Invalid LNURL tag: expected withdrawRequest, got ${data.tag}`)
    }

    const domain = new URL(data.callback).hostname

    return {
      callback: data.callback,
      k1: data.k1,
      minWithdrawable: data.minWithdrawable,
      maxWithdrawable: data.maxWithdrawable,
      defaultDescription: data.defaultDescription ?? '',
      domain,
    }
  }

  async executeWithdraw(
    params: LnurlWithdrawParams,
    bolt11: string,
  ): Promise<LnurlWithdrawResult> {
    const url = new URL(params.callback)
    url.searchParams.set('k1', params.k1)
    url.searchParams.set('pr', bolt11)

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to execute withdraw: ${res.status}`)
    }

    const data = await res.json()
    return {
      status: data.status === 'OK' ? 'OK' : 'ERROR',
      reason: data.reason,
    }
  }

  // ── Auth — LUD-04 ──

  async parseAuth(url: string): Promise<LnurlAuthParams> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch auth params: ${res.status}`)
    }

    const data = await res.json()

    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL-auth endpoint returned error')
    }
    if (data.tag !== 'login') {
      throw new Error(`Invalid LNURL tag: expected login, got ${data.tag}`)
    }

    const domain = new URL(data.callback ?? url).hostname

    return {
      callback: data.callback,
      k1: data.k1,
      domain,
      action: data.action,
    }
  }

  async authenticate(
    params: LnurlAuthParams,
    signature: string,
    publicKey: string,
  ): Promise<LnurlAuthResult> {
    const url = new URL(params.callback)
    url.searchParams.set('sig', signature)
    url.searchParams.set('key', publicKey)
    url.searchParams.set('tag', 'login')

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      throw new Error(`Failed to authenticate: ${res.status}`)
    }

    const data = await res.json()
    return {
      status: data.status === 'OK' ? 'OK' : 'ERROR',
      reason: data.reason,
    }
  }

  // ── LUD-06 description hash 검증 ──

  private async verifyDescriptionHash(
    invoice: string,
    metadata: string,
  ): Promise<void> {
    try {
      const decoded = decode(invoice)
      const sections = decoded.sections as Array<{
        name: string
        value?: unknown
      }>
      const hashSection = sections.find((s) => s.name === 'description_hash')

      if (!hashSection) return

      const encoded = new TextEncoder().encode(metadata)
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      if (hashSection.value !== hashHex) {
        throw new Error(
          'Invoice description_hash does not match metadata hash',
        )
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('does not match')
      ) {
        throw error
      }
    }
  }
}
