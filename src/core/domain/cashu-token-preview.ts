export interface CashuTokenPreview {
  mintUrl: string
  amountSats: number
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return atob(padded)
}

export function previewCashuToken(token: string): CashuTokenPreview {
  const trimmed = token.trim()

  if (trimmed.startsWith('cashuA')) {
    const json = decodeBase64Url(trimmed.slice('cashuA'.length))
    const data = JSON.parse(json) as {
      token?: Array<{ mint?: string; proofs?: Array<{ amount?: number }> }>
    }
    const entry = data.token?.[0]
    const mintUrl = entry?.mint ?? ''
    const amountSats = (entry?.proofs ?? []).reduce((sum, proof) => sum + (proof.amount ?? 0), 0)

    if (!mintUrl) {
      throw new Error('Missing mint URL in cashuA token')
    }

    return { mintUrl, amountSats }
  }

  if (trimmed.startsWith('cashuB')) {
    const json = decodeBase64Url(trimmed.slice('cashuB'.length))
    const data = JSON.parse(json) as {
      m?: string
      t?: Array<{ p?: Array<{ a?: number }> }>
    }
    const mintUrl = data.m ?? ''
    const amountSats = (data.t ?? [])
      .flatMap((entry) => entry.p ?? [])
      .reduce((sum, proof) => sum + (proof.a ?? 0), 0)

    if (!mintUrl) {
      throw new Error('Missing mint URL in cashuB token')
    }

    return { mintUrl, amountSats }
  }

  throw new Error('Unsupported cashu token format')
}
