import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHAIN_API, EsploraChainClient } from '@/adapters/onchain-payout/electrum/chain-client'

const BASE = 'https://chain.example/api'

interface Vectors {
  claim_tx: { claim_tx_hex: string; claim_tx_txid: string }
}

const vectors: Vectors = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/vectors.json', 'utf8'),
)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

function confirmedTx(index: number, address?: string) {
  return {
    txid: `tx-${index}`,
    status: { confirmed: true, block_height: 800000 - index },
    vout: address
      ? [{ n: 0, value: 1000 + index, scriptpubkey_address: address }]
      : [{ n: 0, value: 1000, scriptpubkey_address: 'bcrt1qother' }],
  }
}

function confirmedPage(start: number, count: number, address?: string) {
  return Array.from({ length: count }, (_, i) => confirmedTx(start + i, address))
}

function clientWithResponder(responder: (url: string) => Response) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return responder(String(input))
  })
  const client = new EsploraChainClient({ baseUrl: `${BASE}/`, fetch: fetchMock as typeof fetch })
  return { client, calls }
}

function clientWith(...responses: Response[]) {
  let index = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  })
  const client = new EsploraChainClient({ baseUrl: `${BASE}/`, fetch: fetchMock as typeof fetch })
  return { client, fetchMock }
}

describe('chain client', () => {
  it('reads the tip height', async () => {
    const { client, fetchMock } = clientWith(textResponse('850123\n'))
    expect(await client.tipHeight()).toBe(850123)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/blocks/tip/height`,
      expect.objectContaining({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      }),
    )
  })

  it('rejects a malformed tip height', async () => {
    const { client } = clientWith(textResponse('oops'))
    await expect(client.tipHeight()).rejects.toThrow()
  })

  it('finds every output to the address', async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse([
        {
          txid: 'tx-a',
          status: { confirmed: true, block_height: 800000 },
          vout: [
            { n: 0, value: 20000, scriptpubkey_address: 'bcrt1qtarget' },
            { n: 1, value: 5000, scriptpubkey_address: 'bcrt1qother' },
          ],
        },
        {
          txid: 'tx-b',
          status: { confirmed: false },
          vout: [{ n: 2, value: 77000, scriptpubkey_address: 'bcrt1qtarget' }],
        },
      ]),
    )

    expect(await client.findOutputs('bcrt1qtarget')).toEqual([
      { txid: 'tx-a', vout: 0, value: 20000, confirmedHeight: 800000 },
      { txid: 'tx-b', vout: 2, value: 77000, confirmedHeight: null },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/address/bcrt1qtarget/txs`)
  })

  it('falls back to the output position when the API omits n', async () => {
    const { client } = clientWith(
      jsonResponse([
        {
          txid: 'tx-a',
          status: { confirmed: true, block_height: 800000 },
          vout: [
            { value: 1000, scriptpubkey_address: 'bcrt1qother' },
            { value: 2000, scriptpubkey_address: 'bcrt1qtarget' },
          ],
        },
      ]),
    )
    expect(await client.findOutputs('bcrt1qtarget')).toEqual([
      { txid: 'tx-a', vout: 1, value: 2000, confirmedHeight: 800000 },
    ])
  })

  it('pages the address history until the funding output is found', async () => {
    const pages = new Map<string, Response>()
    pages.set(`${BASE}/address/bcrt1qtarget/txs`, jsonResponse(confirmedPage(0, 25)))
    pages.set(`${BASE}/address/bcrt1qtarget/txs/chain/tx-24`, jsonResponse(confirmedPage(25, 25)))
    pages.set(`${BASE}/address/bcrt1qtarget/txs/chain/tx-49`, jsonResponse(confirmedPage(50, 10, 'bcrt1qtarget')))
    const { client, calls } = clientWithResponder((url) => pages.get(url) ?? jsonResponse([]))

    const outputs = await client.findOutputs('bcrt1qtarget')

    expect(outputs).toHaveLength(10)
    expect(outputs[0]).toEqual({ txid: 'tx-50', vout: 0, value: 1050, confirmedHeight: 799950 })
    expect(calls).toEqual([
      `${BASE}/address/bcrt1qtarget/txs`,
      `${BASE}/address/bcrt1qtarget/txs/chain/tx-24`,
      `${BASE}/address/bcrt1qtarget/txs/chain/tx-49`,
    ])
  })

  it('throws instead of silently truncating a very long history', async () => {
    let page = 0
    const { client, calls } = clientWithResponder(() => {
      const response = jsonResponse(confirmedPage(page * 25, 25))
      page += 1
      return response
    })
    await expect(client.findOutputs('bcrt1qtarget')).rejects.toThrow('address history is too long')
    expect(calls).toHaveLength(40)
  })

  it('reads a confirmed outspend', async () => {
    const { client } = clientWith(
      jsonResponse({ spent: true, txid: 'spend-tx', status: { confirmed: true, block_height: 800010 } }),
    )
    expect(await client.outspend('funding-tx', 0)).toEqual({
      spent: true,
      txid: 'spend-tx',
      confirmedHeight: 800010,
    })
  })

  it('reads an unspent output', async () => {
    const { client } = clientWith(jsonResponse({ spent: false }))
    expect(await client.outspend('funding-tx', 1)).toEqual({ spent: false, confirmedHeight: null })
  })

  it('reads an unconfirmed outspend', async () => {
    const { client } = clientWith(
      jsonResponse({ spent: true, txid: 'spend-tx', status: { confirmed: false } }),
    )
    expect(await client.outspend('funding-tx', 1)).toEqual({
      spent: true,
      txid: 'spend-tx',
      confirmedHeight: null,
    })
  })

  it('broadcasts a transaction', async () => {
    const { client, fetchMock } = clientWith(textResponse('broadcast-txid\n'))
    expect(await client.broadcast('0200')).toBe('broadcast-txid')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/tx`)
  })

  it('treats an already broadcast transaction as success', async () => {
    const { client } = clientWith(
      textResponse('sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}', 400),
    )
    expect(await client.broadcast(vectors.claim_tx.claim_tx_hex)).toBe(
      vectors.claim_tx.claim_tx_txid,
    )
  })

  it('treats txn-already-known as success', async () => {
    const { client } = clientWith(textResponse('txn-already-known', 400))
    expect(await client.broadcast(vectors.claim_tx.claim_tx_hex)).toBe(
      vectors.claim_tx.claim_tx_txid,
    )
  })

  it.each([
    'Transaction outputs already in utxo set',
    'txn-already-in-mempool',
    'TXN-ALREADY-IN-MEMPOOL',
  ])('treats %s as success', async (message) => {
    const { client } = clientWith(textResponse(message, 400))
    expect(await client.broadcast(vectors.claim_tx.claim_tx_hex)).toBe(
      vectors.claim_tx.claim_tx_txid,
    )
  })

  it('throws when the chain rejects the transaction', async () => {
    const { client } = clientWith(textResponse('bad-txns-inputs-missingorspent', 400))
    await expect(client.broadcast('0200')).rejects.toThrow('chain rejected the transaction')
  })

  it('throws on a failed request', async () => {
    const { client } = clientWith(textResponse('server error', 500))
    await expect(client.feeRate()).rejects.toThrow('chain request failed: 500')
  })

  it('picks the fee estimate for the target', async () => {
    const first = clientWith(jsonResponse({ '1': 10.2, '2': 6.1, '6': 2 }))
    expect(await first.client.feeRate()).toBe(7)
    const second = clientWith(jsonResponse({ '1': 10.2, '2': 6.1, '6': 2 }))
    expect(await second.client.feeRate(6)).toBe(2)
  })

  it('never returns a fee rate below one', async () => {
    const { client } = clientWith(jsonResponse({ '2': 0.2 }))
    expect(await client.feeRate()).toBe(1)
  })

  it('throws when the chain has no usable estimate', async () => {
    const empty = clientWith(jsonResponse({}))
    await expect(empty.client.feeRate()).rejects.toThrow('no usable fee estimates')
    const negative = clientWith(jsonResponse({ '2': -1 }))
    await expect(negative.client.feeRate()).rejects.toThrow('no usable fee estimates')
  })

  it('uses the nearest lower target when the exact one is missing', async () => {
    const { client } = clientWith(jsonResponse({ '1': 10, '3': 5, '6': 2 }))
    expect(await client.feeRate(4)).toBe(5)
  })

  it('uses the smallest target when everything is above the target', async () => {
    const { client } = clientWith(jsonResponse({ '3': 5, '6': 2 }))
    expect(await client.feeRate(1)).toBe(5)
  })

  it('reads the transaction fee and virtual size', async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse({ txid: 'tx-a', fee: 1234, weight: 545 }),
    )
    expect(await client.txFee('tx-a')).toEqual({ fee: 1234, vsize: 137 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/tx/tx-a`)
  })

  it('rejects a malformed transaction weight', async () => {
    const { client } = clientWith(jsonResponse({ txid: 'tx-a', fee: 1234 }))
    await expect(client.txFee('tx-a')).rejects.toThrow('malformed transaction fee')
  })

  it('rejects a malformed transaction fee', async () => {
    const { client } = clientWith(jsonResponse({ txid: 'tx-a' }))
    await expect(client.txFee('tx-a')).rejects.toThrow('malformed transaction fee')
  })

  it('reads a raw transaction', async () => {
    const { client, fetchMock } = clientWith(textResponse('0200deadbeef\n'))
    expect(await client.txHex('tx-a')).toBe('0200deadbeef')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/tx/tx-a/hex`)
  })

  it('counts confirmations against the tip', async () => {
    const { client } = clientWith(
      jsonResponse({ confirmed: true, block_height: 100 }),
      textResponse('109'),
    )
    expect(await client.txConfirmations('tx-a')).toBe(10)
  })

  it('reports no confirmations while unconfirmed', async () => {
    const { client } = clientWith(jsonResponse({ confirmed: false }))
    expect(await client.txConfirmations('tx-a')).toBeNull()
  })

  it('knows the default chain endpoints', () => {
    expect(DEFAULT_CHAIN_API.mainnet).toBe('https://mempool.space/api')
    expect(DEFAULT_CHAIN_API.testnet).toBe('https://mempool.space/testnet/api')
    expect(DEFAULT_CHAIN_API.signet).toBe('https://mempool.space/signet/api')
    expect(DEFAULT_CHAIN_API.regtest).toBeUndefined()
  })
})
