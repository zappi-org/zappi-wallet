import { Ok, Err, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { NpubcashAuthError, NpubcashApiError, NpubcashPaymentRequiredError } from '@/core/errors/npubcash'
import type {
  AuthSession,
  AccountInfo,
  AliasResult,
  PaidQuote,
  ClaimResult,
  ClaimStorageMode,
} from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

interface NpubcashResponse<T> {
  error: boolean
  message?: string
  data?: T
}

export class NpubcashAdapter implements PaymentAliasProvider {
  private jwtCache: Map<string, { token: string; expiresAt: number }> = new Map()

  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url
    this.jwtCache.clear()
  }

  async authenticate(signer: NostrSigner): Promise<Result<AuthSession, BaseError>> {
    try {
      const pubkey = signer.getPublicKey()
      const cached = this.jwtCache.get(pubkey)
      if (cached && cached.expiresAt > Date.now() + 60000) {
        return Ok({ token: cached.token, expiresAt: cached.expiresAt })
      }

      const nip98 = signer.createNip98Token(`${this.baseUrl}/api/v2/auth/nip98`, 'GET')
      const result = await this.fetchJson<NpubcashResponse<{ token: string }>>(
        `${this.baseUrl}/api/v2/auth/nip98`,
        { headers: { Authorization: `Nostr ${nip98}` } },
      )

      if (!result.ok) return result

      const body = result.value
      if (body.error || !body.data?.token) {
        return Err(new NpubcashApiError(401, body.message || 'Authentication failed'))
      }

      const token = body.data.token
      const expiresAt = Date.now() + 10 * 60 * 1000

      this.jwtCache.set(pubkey, { token, expiresAt })
      return Ok({ token, expiresAt })
    } catch (e) {
      return Err(new NpubcashAuthError('Authentication failed', e))
    }
  }

  async getAccountInfo(session: AuthSession): Promise<Result<AccountInfo, BaseError>> {
    const result = await this.authFetch<NpubcashResponse<{
      user: { name: string; mintUrl: string; lockQuote: boolean; claimStorageMode: ClaimStorageMode }
      claimBalance: number
    }>>(
      session,
      `${this.baseUrl}/api/v2/user/info`,
    )

    if (!result.ok) return result

    const body = result.value
    if (body.error || !body.data?.user) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to get account info'))
    }

    const user = body.data.user
    return Ok({
      alias: user.name ?? null,
      domain: new URL(this.baseUrl).hostname,
      mintUrl: user.mintUrl,
      lockQuote: user.lockQuote,
      claimStorageMode: user.claimStorageMode ?? 'off',
      claimBalance: body.data.claimBalance ?? 0,
    })
  }

  async purchaseAlias(session: AuthSession, alias: string, cashuToken: string): Promise<Result<AliasResult, BaseError>> {
    if (cashuToken) {
      return this.purchaseAliasWithToken(session, alias, cashuToken)
    }
    return this.purchaseAliasFallback(session, alias)
  }

  private async purchaseAliasWithToken(session: AuthSession, alias: string, cashuToken: string): Promise<Result<AliasResult, BaseError>> {
    console.log('[npubcash] purchaseAliasWithToken:', { alias, tokenPrefix: cashuToken.slice(0, 10), tokenLen: cashuToken.length, baseUrl: this.baseUrl })
    const result = await this.authFetch<NpubcashResponse<{ user: { name: string; pubkey: string } }>>(
      session,
      `${this.baseUrl}/api/v2/user/username`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cashu': cashuToken,
        },
        body: JSON.stringify({ username: alias }),
      },
    )

    if (!result.ok) {
      console.log('[npubcash] purchaseAliasWithToken error:', { message: result.error.message, code: (result.error as { code?: number }).code })
      return result
    }

    const body = result.value
    if (body.error || !body.data?.user) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to purchase username'))
    }

    return Ok({
      alias: body.data.user.name,
      npub: body.data.user.pubkey,
    })
  }

  private async purchaseAliasFallback(session: AuthSession, alias: string): Promise<Result<AliasResult, BaseError>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v2/user/username`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ username: alias }),
      })

      if (res.status === 402) {
        const xCashu = res.headers.get('X-Cashu')
        console.log('[npubcash] 402 received:', { hasXcashu: !!xCashu, xCashuPrefix: xCashu?.slice(0, 10), xCashuLen: xCashu?.length })
        if (!xCashu) {
          return Err(new NpubcashApiError(402, 'Payment required but no X-Cashu header'))
        }
        return Err(new NpubcashPaymentRequiredError(xCashu))
      }

      if (!res.ok) {
        let message = `Purchase failed (HTTP ${res.status})`
        try {
          const body = await res.json() as NpubcashResponse<unknown>
          if (body.message) message = body.message
        } catch { /* noop */ }
        return Err(new NpubcashApiError(res.status, message))
      }

      const body = await res.json() as NpubcashResponse<{ user: { name: string; pubkey: string } }>
      if (body.error || !body.data?.user) {
        return Err(new NpubcashApiError(400, body.message || 'Failed to purchase username'))
      }

      return Ok({
        alias: body.data.user.name,
        npub: body.data.user.pubkey,
      })
    } catch (e) {
      return Err(new NpubcashApiError(500, e instanceof Error ? e.message : 'Network error'))
    }
  }

  async setPreferredMint(session: AuthSession, mintUrl: string): Promise<Result<void, BaseError>> {
    const result = await this.authFetch<NpubcashResponse<unknown>>(
      session,
      `${this.baseUrl}/api/v2/user/mint`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint_url: mintUrl }),
      },
    )

    if (!result.ok) return result

    const body = result.value
    if (body.error) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to set mint'))
    }

    return Ok(undefined)
  }

  async toggleLock(session: AuthSession): Promise<Result<boolean, BaseError>> {
    const info = await this.getAccountInfo(session)
    if (!info.ok) return info

    const newLock = !info.value.lockQuote

    const result = await this.authFetch<NpubcashResponse<unknown>>(
      session,
      `${this.baseUrl}/api/v2/user/lock`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockQuotes: newLock }),
      },
    )

    if (!result.ok) return result

    const body = result.value
    if (body.error) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to toggle lock'))
    }

    return Ok(newLock)
  }

  async getPaidQuotes(session: AuthSession, since?: number): Promise<Result<PaidQuote[], BaseError>> {
    const result = await this.authFetch<NpubcashResponse<{ quotes: PaidQuote[] }>>(
      session,
      `${this.baseUrl}/api/v2/wallet/quotes${since ? `?since=${since}` : ''}`,
    )

    if (!result.ok) return result

    const body = result.value
    if (body.error || !body.data?.quotes) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to get paid quotes'))
    }

    return Ok(body.data.quotes)
  }

  async subscribePaidQuotes(
    signer: NostrSigner,
    onQuoteId: (quoteId: string) => void,
    onDisconnect?: () => void,
  ): Promise<Result<() => void, BaseError>> {
    try {
      const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/v2/ws/quote'
      let currentWs: WebSocket | null = null
      let userClosed = false

      const connect = () => {
        const ws = new WebSocket(wsUrl)
        currentWs = ws
        let pingInterval: ReturnType<typeof setInterval> | null = null

        ws.onopen = () => {
          clearInterval(pingInterval!)
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }))
            }
          }, 25_000)
        }

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string)
            if (msg.type === 'challenge') {
              const token = signer.createNip98Token(msg.payload.url, msg.payload.method)
              ws.send(JSON.stringify({ type: 'challenge-response', payload: `Nostr ${token}` }))
            }
            if (msg.type === 'update') {
              onQuoteId(msg.payload.quoteId)
            }
          } catch { /* noop */ }
        }

        ws.onclose = (_event) => {
          clearInterval(pingInterval!)
          pingInterval = null
          currentWs = null
          if (userClosed) return
          onDisconnect?.()
        }

        ws.onerror = () => {}
      }

      connect()

      return Ok(() => {
        console.log('[Npubcash] unsubscribe() — user closed')
        userClosed = true
        currentWs?.close()
        currentWs = null
      })
    } catch (_e) {
      return Err(new NpubcashApiError(500, 'Failed to connect to quote stream'))
    }
  }

  // ── Custom / Unmerged APIs ───────────────────────────────
  // These endpoints are not yet merged into the upstream npubcash API.
  // Remove this section comment when merged.

  async getBalance(session: AuthSession): Promise<Result<number, BaseError>> {
    console.log('[npubcash] getBalance')
    const result = await this.authFetch<NpubcashResponse<number>>(
      session,
      `${this.baseUrl}/api/v2/balance`,
    )
    if (!result.ok) {
      console.log('[npubcash] getBalance error:', result.error.message)
      return result
    }
    const body = result.value
    if (body.error || body.data === undefined) {
      console.log('[npubcash] getBalance body error:', body.message)
      return Err(new NpubcashApiError(400, body.message || 'Failed to get balance'))
    }
    console.log('[npubcash] getBalance OK:', body.data)
    return Ok(body.data)
  }

  async getClaim(session: AuthSession): Promise<Result<ClaimResult, BaseError>> {
    console.log('[npubcash] getClaim')
    const result = await this.authFetch<NpubcashResponse<ClaimResult>>(
      session,
      `${this.baseUrl}/api/v2/claim`,
    )
    if (!result.ok) {
      console.log('[npubcash] getClaim error:', result.error.message)
      return result
    }
    const body = result.value
    if (body.error || !body.data) {
      console.log('[npubcash] getClaim body error:', body.message)
      return Err(new NpubcashApiError(400, body.message || 'Failed to claim'))
    }
    console.log('[npubcash] getClaim OK:', { totalCount: body.data.totalCount, mints: body.data.tokens.map(t => t.mint) })
    return Ok(body.data)
  }

  async getClaimStorageMode(session: AuthSession): Promise<Result<ClaimStorageMode, BaseError>> {
    const result = await this.authFetch<NpubcashResponse<{ mode: ClaimStorageMode }>>(
      session,
      `${this.baseUrl}/api/v2/user/claim-storage`,
    )
    if (!result.ok) return result
    const body = result.value
    if (body.error || !body.data) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to get claim storage mode'))
    }
    return Ok(body.data.mode)
  }

  async setClaimStorageMode(session: AuthSession, mode: ClaimStorageMode): Promise<Result<ClaimStorageMode, BaseError>> {
    const result = await this.authFetch<NpubcashResponse<{ mode: ClaimStorageMode }>>(
      session,
      `${this.baseUrl}/api/v2/user/claim-storage`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      },
    )
    if (!result.ok) return result
    const body = result.value
    if (body.error || !body.data) {
      return Err(new NpubcashApiError(400, body.message || 'Failed to set claim storage mode'))
    }
    return Ok(body.data.mode)
  }

  private async authFetch<T>(session: AuthSession, url: string, init?: RequestInit): Promise<Result<T, BaseError>> {
    return this.fetchJson<T>(url, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${session.token}` },
    })
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<Result<T, BaseError>> {
    try {
      const res = await fetch(url, init)

      if (!res.ok) {
        let message = `Request failed (HTTP ${res.status})`
        try {
          const body = await res.json() as NpubcashResponse<unknown>
          if (body.message) message = body.message
        } catch { /* noop */ }
        console.log('[npubcash] fetchJson non-OK:', { url, status: res.status, message })
        return Err(new NpubcashApiError(res.status, message))
      }

      const contentType = res.headers?.get?.('content-type') || ''
      try {
        const data = (await res.json()) as T
        console.log('[npubcash] fetchJson OK:', { url, contentType, status: res.status })
        return Ok(data)
      } catch {
        console.log('[npubcash] fetchJson JSON parse error:', { url, contentType, status: res.status })
        let bodyPreview = ''
        try { bodyPreview = await res.clone().text().catch(() => ''); console.log('[npubcash] fetchJson body:', bodyPreview.slice(0, 200)) } catch { /* noop */ }
        return Err(new NpubcashApiError(res.status, `Invalid JSON response (content-type: ${contentType})`))
      }
    } catch (e) {
      if (e instanceof NpubcashApiError) return Err(e)
      console.log('[npubcash] fetchJson network error:', { url, error: e instanceof Error ? e.message : String(e) })
      return Err(new NpubcashApiError(500, e instanceof Error ? e.message : 'Network error'))
    }
  }
}
